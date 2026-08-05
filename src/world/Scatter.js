import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SCATTER } from '../config/balance.js';

/**
 * Scatter — 핏자국 데칼과 의료폐기물 잔해.
 *
 * 폐병원이 무서운 건 어두워서가 아니라 **사람이 있었던 흔적**이 남아서다.
 * 여기서 만드는 건 그 흔적이다. 전투에도 이동에도 영향이 없다 (충돌 없음).
 *
 * 드로우콜: 데칼은 개당 1, 잔해는 종류당 1 (InstancedMesh). 수치는 config/balance.js.
 */

const TEX_DIR = `${import.meta.env.BASE_URL}assets/textures/`;
const BLOOD_KINDS = ['pool', 'splatter', 'drag'];
const WALL_KINDS = ['handprint'];      // 벽에만 쓴다. 바닥 무작위 풀에 넣으면 어색하다

/** 고정 시드 난수 — 매 판 같은 자리에 나와야 레벨이 흔들리지 않는다 */
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 주사기 — 배럴 + 바늘 + 허브 + 밀대. X축으로 눕혀서 만든다 (바닥에 굴러다니게) */
function makeSyringeGeo() {
  const lay = (g, x) => { g.rotateZ(Math.PI / 2); g.translate(x, 0, 0); return g; };
  return mergeGeometries([
    lay(new THREE.CylinderGeometry(0.0065, 0.0065, 0.060, 8), 0),
    lay(new THREE.CylinderGeometry(0.0040, 0.0040, 0.009, 6), 0.034),
    lay(new THREE.CylinderGeometry(0.0012, 0.0012, 0.030, 4), 0.053),
    lay(new THREE.CylinderGeometry(0.0080, 0.0080, 0.005, 8), -0.031),
    lay(new THREE.CylinderGeometry(0.0022, 0.0022, 0.024, 4), -0.042),
  ]);
}

/** 약병 — 작은 유리병 */
function makeVialGeo() {
  const lay = (g, x) => { g.rotateZ(Math.PI / 2); g.translate(x, 0, 0); return g; };
  return mergeGeometries([
    lay(new THREE.CylinderGeometry(0.011, 0.011, 0.040, 8), 0),
    lay(new THREE.CylinderGeometry(0.007, 0.007, 0.008, 6), 0.024),
  ]);
}

/** 흩어진 서류 */
function makePaperGeo() {
  return new THREE.BoxGeometry(0.21, 0.0009, 0.297);
}

export class Scatter {
  constructor() {
    const loader = new THREE.TextureLoader();

    this.decalMat = {};
    for (const k of [...BLOOD_KINDS, ...WALL_KINDS]) {
      const map = loader.load(`${TEX_DIR}decals/decal_blood_${k}.webp`);
      map.colorSpace = THREE.SRGBColorSpace;
      this.decalMat[k] = new THREE.MeshStandardMaterial({
        map,
        // 손전등이 26cd 라 흰색(기본) 그대로 두면 가까이서 분홍으로 타버린다
        color: 0x8e8e8e,
        transparent: true,
        depthWrite: false,          // 바닥 위에 겹쳐 눕는 데칼이라 깊이 기록은 안 한다
        roughness: SCATTER.bloodRoughness,
        metalness: 0,
        polygonOffset: true,        // 바닥과 같은 평면이라 안 하면 z-fighting 이 난다
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      });
    }
    this.decalGeo = new THREE.PlaneGeometry(1, 1);

    this.debrisGeo = {
      syringe: makeSyringeGeo(),
      vial: makeVialGeo(),
      paper: makePaperGeo(),
    };
    // 구역이 바뀌어도 살아남아야 하는 지오메트리 — StageLoader.unload 가 이 표식을 보고 건너뛴다
    this.decalGeo.userData.shared = true;
    for (const g of Object.values(this.debrisGeo)) g.userData.shared = true;
    this.debrisMat = {
      // 금속·유리는 거칠기를 낮춰 반짝이게 한다 — 어두운 바닥에서 이게 유일한 단서다
      syringe: new THREE.MeshStandardMaterial({ color: SCATTER.syringeColor, roughness: 0.18, metalness: 0.65 }),
      vial: new THREE.MeshStandardMaterial({ color: SCATTER.vialColor, roughness: 0.14, metalness: 0.25 }),
      paper: new THREE.MeshStandardMaterial({ color: SCATTER.paperColor, roughness: 0.95, metalness: 0 }),
    };

    this.reset();
  }

  /**
   * 구역 로드 시작마다 호출 — 쌓아둔 잔해 목록을 비운다.
   * @param seed 이 판에 쓸 시드. StageLoader 가 넘긴다.
   *   `SCATTER.randomPerRun` 이 true 면 판마다 달라져서 전리품·잔해 위치가 섞인다.
   */
  reset(seed = SCATTER.seed) {
    this.rng = makeRng(seed);
    this._pending = { syringe: [], vial: [], paper: [] };
    this._debrisCount = 0;
  }

  /** 바닥 핏자국. kind 를 안 주면 무작위 */
  addFloorBlood(group, x, z, size = 1.6, kind = null, y = 0.006) {
    const k = kind ?? BLOOD_KINDS[Math.floor(this.rng() * BLOOD_KINDS.length)];
    const m = new THREE.Mesh(this.decalGeo, this.decalMat[k]);
    m.rotation.set(-Math.PI / 2, 0, this.rng() * Math.PI * 2);
    m.position.set(x, y, z);
    const s = size * (0.75 + this.rng() * 0.6);
    m.scale.set(s, s, 1);
    m.renderOrder = 1;
    group.add(m);
    return m;      // 런타임에 추가한 것(전투 흔적)은 호출부가 개수를 관리한다
  }

  /** 벽 핏자국. yaw 는 벽이 바라보는 방향(라디안) */
  addWallBlood(group, x, y, z, yaw, size = 1.4, kind = 'splatter') {
    const m = new THREE.Mesh(this.decalGeo, this.decalMat[kind] ?? this.decalMat.splatter);
    m.rotation.set(0, yaw, this.rng() * 0.5 - 0.25);
    m.position.set(x, y, z);
    const s = size * (0.8 + this.rng() * 0.5);
    m.scale.set(s, s, 1);
    m.renderOrder = 1;
    group.add(m);
  }

  /** 직사각 구역에 잔해를 뿌린다. 실제 메시는 finalize() 에서 한 번에 만든다 */
  scatterDebris(cx, cz, w, d, density = SCATTER.debrisPerSqm) {
    const kinds = Object.keys(SCATTER.debrisWeights);
    const total = kinds.reduce((s, k) => s + SCATTER.debrisWeights[k], 0);
    const n = Math.round(w * d * density);

    for (let i = 0; i < n; i++) {
      if (this._debrisCount >= SCATTER.debrisMaxTotal) return;
      let pick = this.rng() * total, kind = kinds[0];
      for (const k of kinds) { pick -= SCATTER.debrisWeights[k]; if (pick <= 0) { kind = k; break; } }

      const x = cx + (this.rng() - 0.5) * w;
      const z = cz + (this.rng() - 0.5) * d;
      // 바닥에 누워 있고, 살짝 기울어져 있다 (완벽히 평평하면 가짜로 보인다)
      const yaw = this.rng() * Math.PI * 2;
      const tilt = (this.rng() - 0.5) * 0.25;
      const y = kind === 'paper' ? 0.0012 : 0.010;
      this._pending[kind].push({ x, y, z, yaw, tilt });
      this._debrisCount++;
    }
  }

  /** 모아둔 잔해를 종류별 InstancedMesh 하나로 만든다 (드로우콜 3개) */
  finalize(group) {
    const dummy = new THREE.Object3D();
    for (const kind of Object.keys(this._pending)) {
      const list = this._pending[kind];
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(this.debrisGeo[kind], this.debrisMat[kind], list.length);
      mesh.castShadow = false;      // 잔해까지 그림자를 만들면 예산이 무너진다
      mesh.receiveShadow = true;
      // 잔해임을 표시한다 — 소품 위에 걸쳐도 정상이라, 배치 검사(tools/qa_stages.js)가
      // 소품 겹침으로 세면 안 된다
      mesh.userData.scatter = true;
      list.forEach((it, i) => {
        dummy.position.set(it.x, it.y, it.z);
        dummy.rotation.set(it.tilt, it.yaw, it.tilt * 0.5);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
    }
  }
}
