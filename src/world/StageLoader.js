import * as THREE from 'three';

/**
 * StageLoader — 구역을 짓고, 지우고, 충돌/스폰/조명을 등록한다.
 * 구역 정의(stages/*.js)는 "무엇을 어디에" 만 말하고, 실제 생성은 전부 여기서 한다.
 * 덕분에 구역 파일이 데이터에 가까워져서 수정이 안전하다.
 */
const WALL_H = 3.1;

export class StageLoader {
  constructor(scene, collision, atmosphere, director) {
    this.scene = scene;
    this.collision = collision;
    this.atmosphere = atmosphere;
    this.director = director;
    this.group = null;
    this.spawnPoints = [];
    this.exit = null;

    // 재질은 공유한다 (드로우콜/메모리 예산 — CLAUDE.md §3)
    this.mat = {
      floor: new THREE.MeshStandardMaterial({ color: 0x2b2f2c, roughness: 0.96, metalness: 0.02 }),
      wall: new THREE.MeshStandardMaterial({ color: 0x49544a, roughness: 0.93, metalness: 0.02 }),
      ceiling: new THREE.MeshStandardMaterial({ color: 0x1d211f, roughness: 0.99, metalness: 0 }),
    };
    this.propMats = new Map();

    this.geo = {
      box: new THREE.BoxGeometry(1, 1, 1),
      plane: new THREE.PlaneGeometry(1, 1),
    };
  }

  _propMat(color) {
    if (!this.propMats.has(color)) {
      this.propMats.set(color, new THREE.MeshStandardMaterial({
        color, roughness: 0.9, metalness: 0.08,
      }));
    }
    return this.propMats.get(color);
  }

  unload() {
    if (this.group) {
      this.scene.remove(this.group);
      this.group.traverse((o) => { if (o.isMesh && o.geometry !== this.geo.box && o.geometry !== this.geo.plane) o.geometry.dispose(); });
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
        const m = new THREE.Mesh(this.geo.box, this.mat.wall);
        m.position.set(cx, WALL_H / 2, cz);
        m.scale.set(w, WALL_H, d);
        m.castShadow = true; m.receiveShadow = true;
        this.group.add(m);
        this.collision.addBox(cx, cz, w, d);
      },
      addFloor: (cx, cz, w, d) => {
        const m = new THREE.Mesh(this.geo.plane, this.mat.floor);
        m.rotation.x = -Math.PI / 2;
        m.position.set(cx, 0, cz);
        m.scale.set(w, d, 1);
        m.receiveShadow = true;
        this.group.add(m);
      },
      addCeiling: (cx, cz, w, d) => {
        const m = new THREE.Mesh(this.geo.plane, this.mat.ceiling);
        m.rotation.x = Math.PI / 2;
        m.position.set(cx, WALL_H, cz);
        m.scale.set(w, d, 1);
        this.group.add(m);
      },
      /** 소품 — 충돌 등록됨 (h 는 높이) */
      addProp: (cx, cz, w, h, d, color) => {
        const m = new THREE.Mesh(this.geo.box, this._propMat(color));
        m.position.set(cx, h / 2, cz);
        m.scale.set(w, h, d);
        m.castShadow = true; m.receiveShadow = true;
        this.group.add(m);
        this.collision.addBox(cx, cz, w, d);
      },
      addLight: (x, y, z, mode, color) => this.atmosphere.addEmergencyLight(x, y, z, mode, color),
      addSpawn: (x, z) => this.spawnPoints.push({ x, z }),
    };

    const result = stage.build(ctx) ?? {};
    this.atmosphere.applyStageMood(stage.meta.mood ?? {});
    this.director?.setStage(this.spawnPoints, stage.meta.typeWeights);
    this.exit = result.exit ?? null;

    return result.playerStart ?? { x: 0, z: 0, yaw: 0 };
  }
}
