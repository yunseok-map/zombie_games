import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SCATTER, IMPACT } from '../config/balance.js';
import { makeRng } from './rng.js';

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

/**
 * BloodDecals — 전투 중에 바닥에 남는 핏자국.
 *
 * 예전에는 좀비를 다섯 발 맞혀도 **죽기 전까지 바닥이 처음과 똑같이 깨끗했다** —
 * 핏자국이 사망 이벤트에서만 생겼기 때문이다. "여기서 싸웠다"가 지도처럼 읽히게
 * 하려던 의도가 사망에만 걸려 있었다.
 *
 * 인스턴싱 하나 + 링버퍼라 **드로우콜은 개수와 무관하게 1개**다.
 * 시드 재현(SCATTER.forceSeed)을 흔들면 안 되므로 Scatter.rng 를 쓰지 않고
 * Math.random 을 따로 쓴다 — 이건 스테이지 배치가 아니라 런타임 흔적이다.
 *
 * @param opts 사망 자국(StageLoader)처럼 크고 안 옅어지는 용도로도 쓴다.
 *   `{ count, fade, sizeMin, sizeMax, y }` — 생략하면 전부 IMPACT 의 값.
 *   fade 를 0 으로 주면 옅어지지 않는다(링버퍼가 다 차면 그때 덮어쓴다).
 */
export class BloodDecals {
  constructor(scene, material, geometry, opts = {}) {
    const N = opts.count ?? IMPACT.decalCount;
    this.fade = opts.fade ?? IMPACT.decalFade;
    this.sizeMin = opts.sizeMin ?? IMPACT.decalSizeMin;
    this.sizeMax = opts.sizeMax ?? IMPACT.decalSizeMax;
    this.y = opts.y ?? IMPACT.decalY;
    this.n = N;
    this.next = 0;
    this.age = new Float32Array(N).fill(Infinity);   // Infinity = 빈 슬롯
    this.mesh = new THREE.InstancedMesh(geometry, material.clone(), N);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.count = 0;
    // 인스턴스마다 알파를 따로 줄 수 없으므로(재질이 하나다) 색으로 옅게 만든다
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this._m = new THREE.Matrix4();
    this._used = 0;
    scene.add(this.mesh);
  }

  /** 바닥(x,z)에 자국 하나 */
  stamp(x, z) {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    if (this._used < this.n) this._used++;
    this.mesh.count = this._used;
    this.age[i] = 0;
    const s = this.sizeMin + Math.random() * (this.sizeMax - this.sizeMin);
    // 스크래치를 돌려쓴다 — 총 한 발이 입자 14개를 뿌리고 그중 22% 가 여기로 들어온다.
    // 여기서 행렬을 새로 만들면 전투 내내 GC 가 잘게 돈다.
    this._m.makeRotationX(-Math.PI / 2);
    this._m.multiply(_rotZ.makeRotationZ(Math.random() * Math.PI * 2));
    this._m.scale(_scale.set(s, s, 1));
    this._m.setPosition(x, this.y, z);
    this.mesh.setMatrixAt(i, this._m);
    this.mesh.setColorAt(i, _decalColor.setScalar(1));
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt) {
    if (!this._used || !this.fade) return;   // fade 0 = 사망 자국. 계속 남는다
    let dirty = false;
    for (let i = 0; i < this._used; i++) {
      const a = this.age[i];
      if (a === Infinity || a >= this.fade) continue;
      this.age[i] = a + dt;
      const k = 1 - Math.min(1, this.age[i] / this.fade);
      if (k <= 0) {
        // **다 옅어진 자국은 접어서 치운다.** instanceColor 는 색만 곱하므로 0 으로
        // 보내도 투명해지지 않고 **새까매진다** — 알파는 텍스처와 material.opacity
        // 에서 오는데 둘 다 그대로이기 때문이다(재질은 transparent + map 알파).
        // 그래서 "사라진다"가 아니라 검은 얼룩으로 눌러앉았고, mesh.count 도 안 줄어
        // 그리기까지 계속됐다. 크기 0 으로 접으면 화면에서도 지오메트리에서도 빠진다.
        _fold.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, _fold);
        this.mesh.instanceMatrix.needsUpdate = true;
        this.age[i] = Infinity;              // 빈 슬롯으로 되돌린다
        continue;
      }
      this.mesh.setColorAt(i, _decalColor.setScalar(k));
      dirty = true;
    }
    if (dirty && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** 구역이 바뀌면 흔적도 사라진다 */
  clear() {
    this._used = 0; this.next = 0;
    this.mesh.count = 0;
    this.age.fill(Infinity);
  }
}

const _decalColor = new THREE.Color();
const _rotZ = new THREE.Matrix4();
const _scale = new THREE.Vector3();
const _fold = new THREE.Matrix4();      // 다 옅어진 자국을 크기 0 으로 접을 때 쓴다

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
