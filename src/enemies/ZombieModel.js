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
  // standing_up / crawl 은 절대 넣지 마라 — 엎드린 자세를 골반 높이 이동으로 표현하는데
  // 변환할 때 루트 이동을 지웠기 때문에 공중에 뜬 채로 기어가는 것처럼 보인다.
  scream: ['scream', 'attack_02', 'attack_01'],

  // 기어다니는 개체용. 풀은 타입을 모르고 미리 만들어지므로 클립은 전부 준비해 두고,
  // 어떤 걸 쓸지는 Zombie._animKey() 가 def.crawler 를 보고 고른다.
  crawl:     ['crawl'],
  crawlIdle: ['crawl_idle'],
};

/**
 * 옷 변형. 메시·뼈대는 그대로 두고 diffuse 만 갈아끼운다 —
 * 같은 지오메트리를 공유하므로 개체가 늘어나도 성능 비용은 사실상 0.
 * null 은 원본(피 묻은 셔츠). 텍스처는 gen_zombie_variants.py 가 만든다.
 */
const OUTFITS = ['coat', 'coat', 'scrub', null];
const TEX_DIR = `${import.meta.env.BASE_URL}assets/textures/`;

let _gltf = null;
let _loading = null;
let _outfitSets = null;
const _waiters = [];

/** 변형별로 재질 사본을 미리 만들어 둔다 (개체마다 만들면 셰이더가 그만큼 늘어난다) */
function buildOutfits(gltf) {
  const loader = new THREE.TextureLoader();
  const load = (n) => {
    const t = loader.load(`${TEX_DIR}characters/${n}.webp`);
    t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = false;          // glTF UV 규약. 빼먹으면 텍스처가 위아래로 뒤집힌다
    return t;
  };
  const origs = new Set();
  gltf.scene.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) origs.add(o.material); });

  const sets = new Map();
  for (const name of new Set(OUTFITS)) {
    if (!name) { sets.set(name, null); continue; }
    const body = load(`zombie_${name}_body`);
    const main = load(`zombie_${name}_main`);
    const m = new Map();
    for (const om of origs) {
      const c = om.clone();
      c.map = /body/i.test(om.name || '') ? body : main;
      m.set(om.uuid, c);
    }
    sets.set(name, m);
  }
  return sets;
}

/** 게임 시작 전에 부른다. 로딩이 끝나면 대기 중인 좀비들에게 모델이 붙는다. */
export function preloadZombieModel() {
  if (_loading) return _loading;
  _loading = new GLTFLoader().loadAsync(URL).then((g) => {
    _gltf = g;
    _outfitSets = buildOutfits(g);
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
  // 개체마다 옷을 하나 뽑는다 — 전부 같은 옷이면 무리가 복제인간으로 보인다
  const outfit = OUTFITS[Math.floor(Math.random() * OUTFITS.length)];
  const set = _outfitSets?.get(outfit);
  root.traverse((o) => {
    if (o.isMesh || o.isSkinnedMesh) {
      if (set && set.has(o.material.uuid)) o.material = set.get(o.material.uuid);
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
    if (key === 'death' || key === 'scream' || key === 'hit') {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;   // 쓰러진 자세 / 한 번만 재생
    }
    actions[key] = action;
  }

  // 개체마다 재생속도를 조금씩 다르게 — 전부 같으면 군무처럼 보인다
  const jitter = 0.85 + Math.random() * 0.3;
  return { root, mixer, actions, jitter, outfit };
}
