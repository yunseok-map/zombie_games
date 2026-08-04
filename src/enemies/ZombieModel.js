import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

/**
 * ZombieModel — GLB 를 한 번만 읽고 개체마다 복제해준다.
 *
 * SkinnedMesh 는 그냥 `.clone()` 하면 뼈대가 공유돼서 모든 좀비가 같은 동작을 한다.
 * 반드시 SkeletonUtils.clone 을 써야 한다. 지오메트리·재질은 공유되므로 메모리는 안 늘어난다.
 */

const URL = `${import.meta.env.BASE_URL}assets/models/zombie_shambler.glb`;

/**
 * 상태별 클립 후보. 개체마다 하나씩 뽑아 고정한다.
 * 14마리가 동시에 나오는데 전부 같은 걸음이면 즉시 복제인간으로 보인다.
 */
export const CLIP_VARIANTS = {
  idle:   ['idle_02', 'idle_03', 'idle_01', 'idle_04', 'idle_05'],
  walk:   ['walk_01', 'walk_02', 'walk_03'],
  run:    ['run'],
  attack: ['attack_01', 'attack_02', 'attack_03', 'kicking'],
  death:  ['death_01', 'death_02'],
  hit:    ['hit_01'],
};

let _gltf = null;
let _loading = null;
const _waiters = [];

/** 게임 시작 전에 부른다. 로딩이 끝나면 대기 중인 좀비들에게 모델이 붙는다. */
export function preloadZombieModel() {
  if (_loading) return _loading;
  _loading = new GLTFLoader().loadAsync(URL).then((g) => {
    _gltf = g;
    for (const fn of _waiters) fn();
    _waiters.length = 0;
    return g;
  }).catch((e) => {
    // 모델이 없어도 게임은 캡슐로 돌아가야 한다 (CLAUDE.md §1-2)
    console.warn('[zombie] GLB 로드 실패 — 캡슐 대체 메시로 진행합니다.', e);
    return null;
  });
  return _loading;
}

/** 모델이 준비되면 콜백. 이미 로드됐으면 즉시 호출된다. */
export function requestZombieModel(cb) {
  if (_gltf) { cb(makeInstance()); return; }
  _waiters.push(() => { if (_gltf) cb(makeInstance()); });
  preloadZombieModel();
}

function pick(list, clips) {
  const usable = list.filter((n) => clips.some((c) => c.name === n));
  if (!usable.length) return null;
  return usable[Math.floor(Math.random() * usable.length)];
}

function makeInstance() {
  const root = cloneSkinned(_gltf.scene);
  root.traverse((o) => {
    if (o.isMesh || o.isSkinnedMesh) {
      o.castShadow = true;
      o.receiveShadow = false;      // 그림자 예산 (CLAUDE.md §3) — 받는 쪽은 레벨이면 충분
      o.frustumCulled = false;      // 스킨 메시는 바운딩박스가 안 따라와서 꺼야 안 사라진다
    }
  });

  const mixer = new THREE.AnimationMixer(root);
  const clips = _gltf.animations;

  // 개체마다 변형을 뽑아 고정한다
  const actions = {};
  for (const key of Object.keys(CLIP_VARIANTS)) {
    const name = pick(CLIP_VARIANTS[key], clips);
    if (!name) continue;
    const clip = clips.find((c) => c.name === name);
    const action = mixer.clipAction(clip);
    if (key === 'death') {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;   // 쓰러진 자세로 멈춘다
    }
    actions[key] = action;
  }

  return { root, mixer, actions };
}
