import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SURFACE, LOOT } from '../config/balance.js';
import { Scatter } from './Scatter.js';
import { BUILDERS, signPlate } from './Props.js';
import { propModels, pickFile } from './PropModels.js';

const SIGN_COLS = 4, SIGN_ROWS = 4;   // signage_atlas.webp 분할 (gen_signage.py 와 맞춰야 한다)

/**
 * StageLoader — 구역을 짓고, 지우고, 충돌/스폰/조명을 등록한다.
 * 구역 정의(stages/*.js)는 "무엇을 어디에" 만 말하고, 실제 생성은 전부 여기서 한다.
 * 덕분에 구역 파일이 데이터에 가까워져서 수정이 안전하다.
 */
const WALL_H = 3.1;

const TEX_DIR = `${import.meta.env.BASE_URL}assets/textures/`;
const texLoader = new THREE.TextureLoader();

/** 한 재질에 필요한 맵 3종(색·요철·거칠기)을 불러온다. 텍스처는 전 구역이 공유한다. */
function loadMaps(name, dir = 'surfaces') {
  const map = texLoader.load(`${TEX_DIR}${dir}/${name}_color.webp`);
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = texLoader.load(`${TEX_DIR}${dir}/${name}_normal.webp`);
  const roughnessMap = texLoader.load(`${TEX_DIR}${dir}/${name}_rough.webp`);
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

/**
 * 소품 부품 UV — 박스든 실린더든 크기에 맞춰 균일하게 늘린다.
 * 안 하면 3cm 짜리 부품에 텍스처 한 장이 통째로 들어가 노이즈처럼 보인다.
 */
function fitGenericUV(geo, tile) {
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  const k = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) / tile;
  if (k > 0.02) {
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * k);
    uv.needsUpdate = true;
  }
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
    // 소품용 재질. 손전등이 26cd 라 알베도가 높으면 가까이서 하얗게 탄다 —
    // 벽(텍스처 반영 후 ~0.35)과 비슷한 밝기로 맞춘다.
    const M = (o) => new THREE.MeshStandardMaterial(o);
    const signMap = texLoader.load(`${TEX_DIR}signage/signage_atlas.webp`);
    signMap.colorSpace = THREE.SRGBColorSpace;
    signMap.anisotropy = SURFACE.anisotropy;

    // 소품 전용 PBR 세트 (ambientCG CC0). 벽 맵을 돌려쓰면 소품이 석고처럼 보인다.
    //   prop_enamel  PaintedMetal013 — 칠이 벗겨진 흰 도장철판. 병상·캐비닛·문
    //   prop_metal   Metal038        — 긁힌 어두운 강철. 레일·링거대·바퀴
    //   prop_fabric  Fabric045       — 거친 직물. 매트리스·커튼
    this.tex.enamel = loadMaps('prop_enamel', 'props');
    this.tex.metal = loadMaps('prop_metal', 'props');
    this.tex.fabric = loadMaps('prop_fabric', 'props');
    const N = (k) => new THREE.Vector2(k, k);

    Object.assign(this.mat, {
      metal:      M({ ...this.tex.metal,  color: 0x8a929a, roughness: 1, metalness: 0.75, normalScale: N(0.9) }),
      enamel:     M({ ...this.tex.enamel, color: 0x7d837c, roughness: 1, metalness: 0.15, normalScale: N(1.0) }),
      fabric:     M({ ...this.tex.fabric, color: 0x6e6b61, roughness: 1, metalness: 0,    normalScale: N(1.1) }),
      accent:     M({ ...this.tex.enamel, color: 0x9a3226, roughness: 1, metalness: 0.10, normalScale: N(0.9) }),
      accentDark: M({ ...this.tex.metal,  color: 0x40464a, roughness: 1, metalness: 0.25, normalScale: N(0.8) }),
      glass:      M({ color: 0x9aa8b0, roughness: 0.08, metalness: 0.1,
                      transparent: true, opacity: 0.20, depthWrite: false }),
      sheer:      M({ ...this.tex.fabric, color: 0x4a4d47, roughness: 1,
                      transparent: true, opacity: 0.42, depthWrite: false,
                      side: THREE.DoubleSide, normalScale: new THREE.Vector2(0.5, 0.5) }),
      lamp:       M({ color: 0x1a1e22, emissive: 0xbcd6ff, emissiveIntensity: 0.85, roughness: 0.4 }),
      plate:      M({ map: signMap, color: 0x8e8e8e, roughness: 0.62, metalness: 0.05 }),
      plateGlow:  M({ map: signMap, color: 0x5a5a5a, emissiveMap: signMap,
                      emissive: 0xffffff, emissiveIntensity: 1.1, roughness: 0.6 }),
    });

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

  /**
   * 수색으로 나온 물건을 실제 오브젝트로 꺼내 놓는다.
   * 텍스트만 띄우면 "숫자가 올랐다" 로 끝나지만, 눈앞에 놓이면 집는 행위가 남는다.
   */
  _dropPickup(kind, x, z) {
    const isBattery = kind === 'battery';
    const geo = isBattery
      ? new THREE.BoxGeometry(0.05, 0.11, 0.05)
      : new THREE.CylinderGeometry(0.045, 0.045, 0.055, 8);
    const m = new THREE.Mesh(geo, this._itemMat());
    m.position.set(x + (this.scatter.rng() - 0.5) * 0.3, 0.92, z + (this.scatter.rng() - 0.5) * 0.3);
    m.rotation.set(0.3, this.scatter.rng() * 6.28, 0.25);
    this.group.add(m);

    this.interaction.add({
      x: m.position.x, z: m.position.z, radius: 1.5, once: true, mesh: m,
      prompt: () => (isBattery ? '[E]  배터리 줍기' : '[E]  붕대 줍기'),
      onUse: ({ player, flashlight }) => {
        if (isBattery) {
          flashlight.addBattery(LOOT.battery.amount);
          return `배터리  +${LOOT.battery.amount}`;
        }
        player.heal(LOOT.bandage.heal);
        return `붕대  +${LOOT.bandage.heal}`;
      },
    });
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

    // 재질별 지오메트리 모음. 구역을 다 짓고 나서 한 번에 합친다.
    const buckets = new Map();
    const bucket = (key, mat) => {
      let b = buckets.get(key);
      if (!b) { b = { mat: mat ?? this.mat[key], geos: [] }; buckets.set(key, b); }
      return b.geos;
    };

    const ctx = {
      /**
       * 벽 — 충돌 등록됨.
       * 메시를 바로 만들지 않고 지오메트리만 모아둔다. 같은 재질끼리 합쳐야
       * 드로우콜이 벽 개수만큼 늘어나지 않는다 (그림자 패스에서 한 번 더 그려진다).
       */
      addWall: (cx, cz, w, d) => {
        const g = fitBoxUV(new THREE.BoxGeometry(w, WALL_H, d), w, WALL_H, d, SURFACE.wallTile);
        g.translate(cx, WALL_H / 2, cz);
        bucket('wall').push(g);
        this.collision.addBox(cx, cz, w, d);
      },
      addFloor: (cx, cz, w, d) => {
        const g = fitPlaneUV(new THREE.PlaneGeometry(w, d), w, d, SURFACE.floorTile);
        g.rotateX(-Math.PI / 2); g.translate(cx, 0, cz);
        bucket('floor').push(g);
      },
      addCeiling: (cx, cz, w, d) => {
        const g = fitPlaneUV(new THREE.PlaneGeometry(w, d), w, d, SURFACE.ceilingTile);
        g.rotateX(Math.PI / 2); g.translate(cx, WALL_H, cz);
        bucket('ceiling').push(g);
      },
      /** 소품 — 충돌 등록됨 (h 는 높이) */
      addProp: (cx, cz, w, h, d, color) => {
        const g = fitBoxUV(new THREE.BoxGeometry(w, h, d), w, h, d, SURFACE.propTile);
        g.translate(cx, h / 2, cz);
        bucket(`prop_${color}`, this._propMat(color)).push(g);
        this.collision.addBox(cx, cz, w, d);
      },
      addLight: (x, y, z, mode, color) => this.atmosphere.addEmergencyLight(x, y, z, mode, color),
      addSpawn: (x, z) => this.spawnPoints.push({ x, z }),

      /** 바닥 핏자국 (kind: 'pool' | 'splatter' | 'drag', 생략하면 무작위) */
      addBlood: (x, z, size, kind, y) => this.scatter.addFloorBlood(this.group, x, z, size, kind, y),
      /** 벽 핏자국 — yaw 는 벽이 바라보는 방향 */
      addWallBlood: (x, y, z, yaw, size, kind) => this.scatter.addWallBlood(this.group, x, y, z, yaw, size, kind),
      /**
       * 절차적 소품 배치 (world/Props.js).
       * @param kind BUILDERS 키 · @param yaw 라디안 · opts.args 빌더 인자 ·
       *        opts.y 높이 · opts.collide [w,d] 충돌 박스
       */
      addProp3D: (kind, x, z, yaw = 0, opts = {}) => {
        // Sketchfab GLB 가 있으면 그쪽이 이긴다. 스테이지 파일은 고치지 않는다.
        // (기울어진 배치 opts.roll/pitch 는 절차적 전용이라 GLB 를 건너뛴다)
        if (!opts.roll && !opts.pitch && !opts.forceProc) {
          const file = pickFile(kind, opts.args);
          if (file && propModels.place(file, x, opts.y ?? 0, z, yaw)) {
            if (opts.collide) this.collision.addBox(x, z, opts.collide[0], opts.collide[1]);
            return;
          }
        }
        const build = BUILDERS[kind];
        if (!build) { console.warn('[stage] 없는 소품:', kind); return; }
        for (const { mat, geo } of build(...(opts.args ?? []))) {
          fitGenericUV(geo, SURFACE.propTile);        // 회전 전에 — 로컬 크기 기준
          if (opts.roll) geo.rotateZ(opts.roll);      // 넘어짐·기울어짐
          if (opts.pitch) geo.rotateX(opts.pitch);
          if (yaw) geo.rotateY(yaw);
          geo.translate(x, opts.y ?? 0, z);
          bucket(mat).push(geo);
        }
        if (opts.collide) this.collision.addBox(x, z, opts.collide[0], opts.collide[1]);
      },

      /**
       * GLB 소품을 이름으로 직접 배치 (PropModels.EXTRA_GLB — 절차적 대응이 없는 것).
       * 원점이 바닥 중앙이라 y 를 안 주면 바닥에 놓인다.
       * @param opts.y 높이 · opts.collide [w,d] 충돌 박스
       */
      addPropGLB: (name, x, z, yaw = 0, opts = {}) => {
        if (!propModels.place(name, x, opts.y ?? 0, z, yaw)) {
          console.warn('[stage] 없는 GLB 소품:', name); return;
        }
        if (opts.collide) this.collision.addBox(x, z, opts.collide[0], opts.collide[1]);
      },

      /**
       * 뒤질 수 있는 수납가구. 아포칼립스의 기본 루프 —
       * 배터리를 찾으려면 어두운 방으로 들어가야 하고, 뒤지는 소리가 좀비를 부른다.
       * 결과는 고정 시드라 매 판 같다 (레벨이 흔들리면 안 된다).
       */
      addSearchable: (x, z, label = '수납장') => {
        const roll = this.scatter.rng();
        const tot = LOOT.battery.weight + LOOT.bandage.weight + LOOT.empty.weight;
        const kind = roll * tot < LOOT.battery.weight ? 'battery'
          : roll * tot < LOOT.battery.weight + LOOT.bandage.weight ? 'bandage' : 'empty';
        this.interaction.add({
          x, z, radius: 1.7, once: true, noisy: true,
          prompt: () => `[E]  ${label} 뒤지기`,
          onUse: () => {
            if (kind === 'empty') return '비어 있다';
            // 알림만 띄우지 않는다. 찾은 물건을 실제로 꺼내 놓고 직접 집게 한다.
            this._dropPickup(kind, x, z);
            return kind === 'battery' ? '배터리가 나왔다' : '붕대가 나왔다';
          },
        });
      },

      /**
       * 레버 — 올리면 큰 소음이 나고 콜백이 불린다 (발전기 복구용).
       * onPull 은 몇 번째인지(1부터)를 받는다.
       */
      addLever: (x, z, yaw, label, onPull) => {
        const pulled = { done: false };
        for (const { mat, geo } of BUILDERS.lever()) {
          fitGenericUV(geo, SURFACE.propTile);
          if (yaw) geo.rotateY(yaw);
          geo.translate(x, 0, z);
          bucket(mat).push(geo);
        }
        this.interaction.add({
          x, z, radius: 2.0, once: true, noisy: true,
          prompt: () => `[E]  ${label} 올리기`,
          onUse: () => { pulled.done = true; return onPull?.() ?? `${label} 작동`; },
        });
      },
      /** 이벤트용 강제 웨이브 */
      triggerWave: (count, type) => this.director?.triggerWave(count, type),
      /** 구역 분위기 전환 (전원 복구 등) */
      setMood: (mood) => this.atmosphere.applyStageMood(mood),
      /** 등록된 비상등 전부의 모드·밝기를 바꾼다 */
      setLights: (mode, scale = 1) => {
        for (const e of this.atmosphere.emergencyLights) {
          e.mode = mode; e.base = e.base * scale; e.value = 1;
        }
      },

      /** 명패·포스터·표지. slot 은 아틀라스 칸 번호 (0~15), glow 면 자체발광 */
      addSign: (slot, x, y, z, yaw, w, h, glow = false, roll = 0) => {
        const col = slot % SIGN_COLS, row = Math.floor(slot / SIGN_COLS);
        for (const { geo } of signPlate(w, h, col, row, SIGN_COLS, SIGN_ROWS)) {
          if (roll) geo.rotateZ(roll);
          geo.rotateY(yaw);
          geo.translate(x, y, z);
          bucket(glow ? 'plateGlow' : 'plate').push(geo);
        }
      },

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
    propModels.reset();
    // 바닥 재질 질의 — 발소리가 이걸 본다. 스테이지가 정의하지 않으면 콘크리트
    this.surfaceAt = stage.surfaceAt ?? (() => 'concrete');
    const result = stage.build(ctx) ?? {};

    // ── 병합 ── 벽 126개가 각각 드로우콜이면 그림자 패스까지 252개가 된다
    for (const [key, b] of buckets) {
      if (!b.geos.length) continue;
      const merged = mergeGeometries(b.geos, false);
      for (const g of b.geos) g.dispose();
      if (!merged) { console.warn('[stage] 병합 실패:', key); continue; }
      const m = new THREE.Mesh(merged, b.mat);
      // 천장과 반투명(유리·커튼·표지)은 그림자를 만들지 않는다 — 예산이자 시각적으로도 틀리다
      m.castShadow = key !== 'ceiling' && !b.mat.transparent;
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;         // 정적 지오메트리 — 매 프레임 행렬 갱신 불필요
      if (b.mat.transparent) m.renderOrder = 2;
      this.group.add(m);
    }

    // GLB 소품은 병합 대상이 아니다(재질이 제각각). 대신 같은 소품끼리 인스턴싱으로 묶는다.
    propModels.flush(this.group);

    this.scatter.finalize(this.group);
    this.atmosphere.applyStageMood(stage.meta.mood ?? {});
    this.director?.setStage(this.spawnPoints, stage.meta.typeWeights);
    this.exit = result.exit ?? null;

    return result.playerStart ?? { x: 0, z: 0, yaw: 0 };
  }
}
