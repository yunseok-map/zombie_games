import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SURFACE } from '../config/balance.js';

/**
 * PropModels — Sketchfab 소품 GLB 를 한 번만 읽고, 배치는 InstancedMesh 로 묶는다.
 *
 * 왜 인스턴싱인가: 같은 침대를 4개 놓으면 드로우콜이 4배가 된다.
 * 드로우콜 예산은 300 인데 이미 116 을 쓰고 있다 (CLAUDE.md §3).
 * 그래서 배치를 모아 두었다가 스테이지 조립이 끝난 뒤 한 번에 묶는다.
 *
 * GLB 는 `tools/import_props.py` 가 만든다 — 원점이 바닥 중앙, 크기는 실측(m),
 * 축은 세워진 상태다. 그래서 여기서는 위치·회전만 주면 된다.
 */

const DIR = `${import.meta.env.BASE_URL}assets/models/props/`;

/**
 * 절차적 소품(Props.js BUILDERS) → GLB 파일 이름.
 * 여기 있으면 StageLoader.addProp3D 가 절차적 지오메트리 대신 GLB 를 쓴다.
 * 스테이지 파일(stages/*.js)은 고치지 않아도 된다 — 부르는 쪽은 그대로다.
 */
export const PROP_GLB = {
  bed: 'prop_bed',                 // args[0] 이 1 이면 prop_bed_worn (아래 pickFile)
  wheelchair: 'prop_wheelchair',
  cart: 'prop_trolley',
  cabinet: 'prop_cabinet',
  extinguisher: 'prop_extinguisher',
  curtain: 'prop_curtain',
  ivStand: 'prop_ivpole',
  chairRow: 'prop_bench',
  receptionDesk: 'prop_reception_desk',
  vendingMachine: 'prop_vending',
};

/** 스테이지가 직접 이름으로 부를 수 있는 소품 (BUILDERS 에 대응이 없는 것들) */
export const EXTRA_GLB = [
  'prop_bed_worn', 'prop_corpse', 'prop_bodybag', 'prop_morgue_lockers',
  'prop_autopsy_table', 'prop_surgical_lamp', 'prop_sink', 'prop_ventilator',
  'prop_computer_cart', 'prop_mop_bucket', 'prop_water_cooler', 'prop_firstaid',
  'prop_panel', 'prop_ivdrip',
];

/** bed 처럼 변형이 있는 것은 인자를 보고 파일을 고른다 */
export function pickFile(kind, args = []) {
  if (kind === 'bed') return (args[0] | 0) % 2 === 1 ? 'prop_bed_worn' : 'prop_bed';
  return PROP_GLB[kind];
}

class PropModelLibrary {
  constructor() {
    this.protos = new Map();      // 이름 → { parts: [{geo, mat, matrix}] }
    this.queue = new Map();       // 이름 → [Matrix4]
    this.loaded = false;
  }

  has(name) { return this.protos.has(name); }

  /** 게임 시작 전에 한 번. 실패해도 게임은 돌아간다 — 절차적 소품으로 되돌아간다. */
  async preload() {
    if (this.loaded) return;
    const loader = new GLTFLoader();
    const names = [...new Set([...Object.values(PROP_GLB), ...EXTRA_GLB])];
    const jobs = names.map((name) => new Promise((resolve) => {
      loader.load(
        `${DIR}${name}.glb`,
        (gltf) => { this._register(name, gltf.scene); resolve(); },
        undefined,
        (err) => { console.warn('[props] 못 읽음:', name, err?.message ?? err); resolve(); },
      );
    }));
    await Promise.all(jobs);
    this.loaded = true;
    console.info(`[props] GLB ${this.protos.size}/${names.length}종 로드`);
  }

  /** GLB 씬을 (지오메트리, 재질, 로컬행렬) 목록으로 납작하게 편다 */
  _register(name, scene) {
    scene.updateMatrixWorld(true);
    const parts = [];
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) this._tuneMaterial(m);
      parts.push({
        geo: o.geometry,
        mat: Array.isArray(o.material) ? o.material[0] : o.material,
        matrix: o.matrixWorld.clone(),
      });
    });
    if (parts.length) this.protos.set(name, { parts });
  }

  /**
   * 손전등이 26cd 라 기본값 그대로면 가까이서 하얗게 탄다 (ASSETS.md · 알려진 함정).
   * 재질을 새로 만들지 않고 원본 색만 눌러서 텍스처는 그대로 살린다.
   */
  _tuneMaterial(m) {
    if (!m || m.userData._tuned) return;
    m.userData._tuned = true;
    if (m.color) m.color.multiplyScalar(SURFACE.propModelDim);
    if (m.roughness !== undefined) m.roughness = Math.max(m.roughness, SURFACE.propModelRoughMin);
    if (m.metalness !== undefined) m.metalness = Math.min(m.metalness, SURFACE.propModelMetalMax);
    m.envMapIntensity = 0;      // 환경맵이 없다 — 켜두면 검게 죽는다
  }

  /** 배치 예약. 스테이지 조립 중에 부르고, 실제 메시는 flush 에서 만든다. */
  place(name, x, y, z, yaw = 0, extra = null) {
    if (!this.protos.has(name)) return false;
    const m = new THREE.Matrix4().makeRotationY(yaw);
    m.setPosition(x, y, z);
    if (extra) m.multiply(extra);
    if (!this.queue.has(name)) this.queue.set(name, []);
    this.queue.get(name).push(m);
    return true;
  }

  /** 예약된 배치를 InstancedMesh 로 묶어 group 에 넣는다. 스테이지 조립 마지막에 부른다. */
  flush(group) {
    let meshes = 0;
    for (const [name, list] of this.queue) {
      const proto = this.protos.get(name);
      for (const part of proto.parts) {
        const mesh = list.length === 1
          ? new THREE.Mesh(part.geo, part.mat)
          : new THREE.InstancedMesh(part.geo, part.mat, list.length);
        const tmp = new THREE.Matrix4();
        if (list.length === 1) {
          mesh.applyMatrix4(tmp.copy(list[0]).multiply(part.matrix));
        } else {
          list.forEach((m, i) => mesh.setMatrixAt(i, tmp.copy(m).multiply(part.matrix)));
          mesh.instanceMatrix.needsUpdate = true;
          mesh.computeBoundingSphere();
        }
        mesh.castShadow = true;
        mesh.receiveShadow = false;   // 그림자 예산 (CLAUDE.md §3) — 받는 건 레벨이면 충분
        // 지오메트리는 프로토타입과 공유한다. StageLoader.unload 가 dispose 하면 안 된다.
        part.geo.userData.shared = true;
        group.add(mesh);
        meshes++;
      }
    }
    this.queue.clear();
    return meshes;
  }

  /** 스테이지를 새로 로드하기 전에. 프로토타입은 남기고 예약만 버린다. */
  reset() { this.queue.clear(); }
}

export const propModels = new PropModelLibrary();
