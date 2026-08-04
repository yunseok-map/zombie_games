import * as THREE from 'three';
import { SURFACE } from '../config/balance.js';
import { Scatter } from './Scatter.js';

/**
 * StageLoader — 구역을 짓고, 지우고, 충돌/스폰/조명을 등록한다.
 * 구역 정의(stages/*.js)는 "무엇을 어디에" 만 말하고, 실제 생성은 전부 여기서 한다.
 * 덕분에 구역 파일이 데이터에 가까워져서 수정이 안전하다.
 */
const WALL_H = 3.1;

const TEX_DIR = `${import.meta.env.BASE_URL}assets/textures/`;
const texLoader = new THREE.TextureLoader();

/** 한 재질에 필요한 맵 3종(색·요철·거칠기)을 불러온다. 텍스처는 전 구역이 공유한다. */
function loadMaps(name) {
  const map = texLoader.load(`${TEX_DIR}${name}_color.webp`);
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = texLoader.load(`${TEX_DIR}${name}_normal.webp`);
  const roughnessMap = texLoader.load(`${TEX_DIR}${name}_rough.webp`);
  for (const t of [map, normalMap, roughnessMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;   // UV 가 1을 넘어도 반복되게
    t.anisotropy = SURFACE.anisotropy;
  }
  return { map, normalMap, roughnessMap };
}

function makeMat(maps, tint, normalScale) {
  return new THREE.MeshStandardMaterial({
    ...maps,
    color: tint,
    roughness: 1,          // roughnessMap 에 곱해진다
    metalness: 0,
    normalScale: new THREE.Vector2(normalScale, normalScale),
  });
}

/**
 * 박스 UV 를 실제 크기에 맞춘다. 이걸 안 하면 텍스처가 벽 크기대로 늘어나서
 * 긴 복도 벽 하나에 무늬가 딱 한 번만 나온다 — 그게 "종이 같아 보이는" 원인이다.
 * BoxGeometry 면 순서: +X, -X, +Y, -Y, +Z, -Z (면당 정점 4개)
 */
function fitBoxUV(geo, w, h, d, tile) {
  const uv = geo.attributes.uv;
  const faceSize = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = faceSize[f];
    for (let i = f * 4; i < f * 4 + 4; i++) {
      uv.setXY(i, (uv.getX(i) * su) / tile, (uv.getY(i) * sv) / tile);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

function fitPlaneUV(geo, w, d, tile) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * d) / tile);
  }
  uv.needsUpdate = true;
  return geo;
}

export class StageLoader {
  constructor(scene, collision, atmosphere, director, interaction) {
    this.scene = scene;
    this.collision = collision;
    this.atmosphere = atmosphere;
    this.director = director;
    this.interaction = interaction;
    this.group = null;
    this.spawnPoints = [];
    this.exit = null;

    // 텍스처·재질은 전 구역이 공유한다 (메모리 예산 — CLAUDE.md §3)
    this.tex = {
      wall: loadMaps('wall_plaster_peeling'),
      floor: loadMaps('floor_tile_hospital'),
      ceiling: loadMaps('ceiling_panel_office'),
    };
    this.mat = {
      floor: makeMat(this.tex.floor, SURFACE.floorTint, SURFACE.floorNormalScale),
      wall: makeMat(this.tex.wall, SURFACE.wallTint, SURFACE.wallNormalScale),
      ceiling: makeMat(this.tex.ceiling, SURFACE.ceilingTint, SURFACE.ceilingNormalScale),
    };
    this.propMats = new Map();
    this.scatter = new Scatter();
  }

  /** 아이템은 어두운 복도에서 찾을 수 있어야 한다 — 약하게 발광시킨다 (블룸이 받아준다) */
  _itemMat() {
    if (!this._itemMaterial) {
      this._itemMaterial = new THREE.MeshStandardMaterial({
        color: 0x2a3a34, roughness: 0.4, metalness: 0.2,
        emissive: 0x2f9c6a, emissiveIntensity: 1.5,
      });
    }
    return this._itemMaterial;
  }

  /** 소품은 벽과 같은 맵을 쓰고 색만 다르게 — 재질이 늘어나도 텍스처는 안 늘어난다 */
  _propMat(color) {
    if (!this.propMats.has(color)) {
      this.propMats.set(color, makeMat(this.tex.wall, color, SURFACE.propNormalScale));
    }
    return this.propMats.get(color);
  }

  unload() {
    if (this.group) {
      this.scene.remove(this.group);
      this.group.traverse((o) => {
        if (o.isMesh && !o.geometry.userData.shared) o.geometry.dispose();
      });
      this.group = null;
    }
    this.collision.clear();
    this.atmosphere.clearLights();
    this.spawnPoints = [];
    this.exit = null;
  }

  /** @param {{meta:object, build:Function}} stage */
  load(stage) {
    this.unload();
    this.group = new THREE.Group();
    this.scene.add(this.group);

    const ctx = {
      /** 벽 — 충돌 등록됨 */
      addWall: (cx, cz, w, d) => {
        const g = fitBoxUV(new THREE.BoxGeometry(w, WALL_H, d), w, WALL_H, d, SURFACE.wallTile);
        const m = new THREE.Mesh(g, this.mat.wall);
        m.position.set(cx, WALL_H / 2, cz);
        m.castShadow = true; m.receiveShadow = true;
        this.group.add(m);
        this.collision.addBox(cx, cz, w, d);
      },
      addFloor: (cx, cz, w, d) => {
        const g = fitPlaneUV(new THREE.PlaneGeometry(w, d), w, d, SURFACE.floorTile);
        const m = new THREE.Mesh(g, this.mat.floor);
        m.rotation.x = -Math.PI / 2;
        m.position.set(cx, 0, cz);
        m.receiveShadow = true;
        this.group.add(m);
      },
      addCeiling: (cx, cz, w, d) => {
        const g = fitPlaneUV(new THREE.PlaneGeometry(w, d), w, d, SURFACE.ceilingTile);
        const m = new THREE.Mesh(g, this.mat.ceiling);
        m.rotation.x = Math.PI / 2;
        m.position.set(cx, WALL_H, cz);
        this.group.add(m);
      },
      /** 소품 — 충돌 등록됨 (h 는 높이) */
      addProp: (cx, cz, w, h, d, color) => {
        const g = fitBoxUV(new THREE.BoxGeometry(w, h, d), w, h, d, SURFACE.propTile);
        const m = new THREE.Mesh(g, this._propMat(color));
        m.position.set(cx, h / 2, cz);
        m.castShadow = true; m.receiveShadow = true;
        this.group.add(m);
        this.collision.addBox(cx, cz, w, d);
      },
      addLight: (x, y, z, mode, color) => this.atmosphere.addEmergencyLight(x, y, z, mode, color),
      addSpawn: (x, z) => this.spawnPoints.push({ x, z }),

      /** 바닥 핏자국 (kind: 'pool' | 'splatter' | 'drag', 생략하면 무작위) */
      addBlood: (x, z, size, kind) => this.scatter.addFloorBlood(this.group, x, z, size, kind),
      /** 벽 핏자국 — yaw 는 벽이 바라보는 방향 */
      addWallBlood: (x, y, z, yaw, size) => this.scatter.addWallBlood(this.group, x, y, z, yaw, size),
      /** 의료폐기물 산포 — 직사각 구역에 뿌린다 */
      scatterDebris: (cx, cz, w, d, density) => this.scatter.scatterDebris(cx, cz, w, d, density),

      /** 주울 수 있는 아이템. id 는 player.items 에 들어간다 */
      addItem: (x, z, id, label, y = 0.95) => {
        const g = new THREE.BoxGeometry(0.085, 0.005, 0.054);
        const m = new THREE.Mesh(g, this._itemMat());
        m.position.set(x, y, z);
        m.rotation.set(0.1, Math.random() * Math.PI, 0.06);
        this.group.add(m);
        this.interaction.add({
          x, z, radius: 1.9, once: true, mesh: m,
          prompt: () => `[E]  ${label} 줍기`,
          onUse: ({ player }) => { player.items.add(id); return `${label} 획득`; },
        });
      },

      /**
       * 잠긴 문. requires 를 가지고 있어야 열린다.
       * 열리면 충돌이 꺼지고 문이 옆으로 미끄러진다.
       */
      addDoor: (cx, cz, w, d, requires, label) => {
        const g = fitBoxUV(new THREE.BoxGeometry(w, WALL_H, d), w, WALL_H, d, SURFACE.wallTile);
        const m = new THREE.Mesh(g, this._propMat(0x4b5250));
        m.position.set(cx, WALL_H / 2, cz);
        m.castShadow = true; m.receiveShadow = true;
        this.group.add(m);
        const box = this.collision.addBox(cx, cz, w, d);

        this.interaction.add({
          x: cx, z: cz, radius: 2.3, once: true, noisy: true,
          prompt: ({ player }) => (player.items.has(requires)
            ? `[E]  ${label} 열기`
            : `${label} — 잠김. 카드키가 필요하다`),
          onUse: ({ player }) => {
            if (!player.items.has(requires)) return { msg: '카드키가 없다', done: false };
            box.enabled = false;
            this.interaction.slide(m, w * 0.94, 0);
            return `${label} 개방`;
          },
        });
      },
    };

    this.scatter.reset();
    this.interaction.reset();
    const result = stage.build(ctx) ?? {};
    this.scatter.finalize(this.group);
    this.atmosphere.applyStageMood(stage.meta.mood ?? {});
    this.director?.setStage(this.spawnPoints, stage.meta.typeWeights);
    this.exit = result.exit ?? null;

    return result.playerStart ?? { x: 0, z: 0, yaw: 0 };
  }
}
