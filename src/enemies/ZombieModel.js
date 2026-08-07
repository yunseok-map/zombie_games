import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { ZOMBIE_LOOK } from '../config/balance.js';

/**
 * ZombieModel — GLB 를 한 번만 읽고 개체마다 복제해준다.
 *
 * SkinnedMesh 는 그냥 `.clone()` 하면 뼈대가 공유돼서 모든 좀비가 같은 동작을 한다.
 * 반드시 SkeletonUtils.clone 을 써야 한다. 지오메트리·재질은 공유되므로 메모리는 안 늘어난다.
 */

const MODEL_DIR = `${import.meta.env.BASE_URL}assets/models/`;

/**
 * 본체 모델 세 종. 실루엣이 서로 확실히 달라야 무리가 복제인간으로 안 보인다.
 *   base    — ZombieGirl. 크롭탑 + 반바지. 옷 변형은 **텍스처만** 갈아끼운다.
 *   nurse   — 흰 전신 방호복. 후드·마스크·고글·니트릴 장갑.
 *   surgeon — 민트색 수술복 + 수술모. 등이 찢겨 있다.
 *
 * **옷은 텍스처가 아니라 메시로 만들어야 한다.** base 를 아무리 희게 칠해도
 * 실루엣이 "짧은 흰 상의 + 맨다리"라 의료진으로 안 읽힌다. 그래서 별도 모델을 쓴다.
 *
 * `clipsFrom` — 애니메이션을 **다른 본체에서 빌려 쓴다**는 뜻.
 * Mixamo 리그는 뼈 이름이 같으므로 three.js 가 이름으로 붙여 준다. 같은 24클립을
 * 본체마다 한 벌씩 싣는 것은 순수한 낭비다(본체당 약 3.1MB).
 * surgeon 은 nurse 와 뼈 65개가 **완전히 일치**해서 안전하다 — 확인하고 넣은 것이다.
 * base 는 눈뼈 2개가 더 있고 손가락 뼈 4개가 없어 혼자 다르므로 자기 클립을 쓴다.
 * (어긋난 채로 빌려 쓰면 three.js 가 "no target node found" 를 경고로 뱉고 QA 가 실패한다)
 */
const MODEL_FILES = {
  base: { file: 'zombie_shambler.glb' },
  nurse: { file: 'zombie_nurse.glb', tune: true },
  surgeon: { file: 'zombie_surgeon.glb', clipsFrom: 'nurse', tune: true },
  // 경찰. 방역선을 지키던 쪽도 물렸다는 이야기를 실루엣 하나로 한다.
  // 원본(Sketchfab)은 `mixamorig:` 접두어가 빠진 Mixamo 리그였다 — 이름만 붙여 주니
  // 뼈 65개가 간호사와 **하나도 안 틀리고** 일치해서 클립을 그대로 빌려 쓴다.
  // 흰 가운 보정(tune)은 안 건다. 어두운 제복이라 더 누르면 검은 덩어리가 된다.
  cop: { file: 'zombie_cop.glb', clipsFrom: 'nurse' },
};

/**
 * 상태별 클립 후보. 개체마다 하나씩 뽑아 고정한다.
 * 14마리가 동시에 나오는데 전부 같은 걸음이면 즉시 복제인간으로 보인다.
 */
export const CLIP_VARIANTS = {
  idle:   ['idle_02', 'idle_03', 'idle_01', 'idle_04', 'idle_05'],
  // **walk_01 과 walk_04 를 뺐다. 둘 다 걷기 클립이 아니다.** (2026-08-07 실측)
  //   walk_01 — 29.87초에 보폭이 사실상 없다(0.06m/s). 맞추려면 18배속이 필요하다.
  //   walk_04 — 클립 중간(t=0.49)에 **가장 낮은 뼈가 바닥에서 0.89m** 뜬다. 몸이 통째로 난다.
  // 이 둘이 절반을 차지하고 있었다. 미끄러짐이 결함을 가리고 있었다 —
  // 배속 상한에 막혀 클립이 앞부분만 재생되던 탓에 공중부양 구간까지 가지도 못했다.
  // (재는 법: tools/measure_contact.js 의 measureStride, 그리고 클립별 최저뼈 Y 훑기)
  //
  // walk_05 는 Sketchfab 의 "Zombie Walk"(OSCAR CREATIVO) 다. 뼈가 mixamorig 로 같아서
  // 그대로 붙는다 — 걷기 변형이 2종 → 3종이 됐다. (2026-08-07, ASSETS.md §4-C)
  walk:   ['walk_02', 'walk_03', 'walk_05'],
  run:    ['run', 'run_02'],
  attack: ['attack_01', 'attack_02', 'attack_03', 'attack_04', 'attack_05', 'kicking'],
  death:  ['death_01', 'death_02', 'death_03'],
  // 피격 반응이 하나뿐이면 14마리가 전부 같은 동작으로 움찔한다 — 즉시 복제인간으로 보인다
  hit:    ['hit_01', 'hit_02', 'hit_03'],
  // standing_up / crawl 은 절대 넣지 마라 — 엎드린 자세를 골반 높이 이동으로 표현하는데
  // 변환할 때 루트 이동을 지웠기 때문에 공중에 뜬 채로 기어가는 것처럼 보인다.
  // 2026-08-05 에 scream 클립을 실제로 넣었다. 그 전까지는 파일이 없어서 attack_02 로
  // 폴백됐고, 발견 순간에 좀비가 비명 대신 **후려치는 동작**을 하고 있었다.
  // 이제 폴백 후보를 지운다 — 남겨 두면 2/3 이 계속 공격 동작으로 뽑힌다.
  scream: ['scream'],

  // 기어다니는 개체용. 풀은 타입을 모르고 미리 만들어지므로 클립은 전부 준비해 두고,
  // 어떤 걸 쓸지는 Zombie._animKey() 가 def.crawler 를 보고 고른다.
  crawl:     ['crawl', 'crawl_02'],
  crawlIdle: ['crawl_idle'],
};

/**
 * 옷 변형. 메시·뼈대는 그대로 두고 diffuse 만 갈아끼운다 —
 * 같은 지오메트리를 공유하므로 개체가 늘어나도 성능 비용은 사실상 0.
 * null 은 원본(피 묻은 셔츠). 텍스처는 gen_zombie_variants.py 가 만든다.
 */
// 흰 가운이 이 병원의 얼굴이다 — 의료진이 먼저 감염됐다는 이야기가 옷으로 읽혀야 한다.
// 배열에 들어간 비율만큼 뽑힌다: **가운 8 / 수술복 1 / 원본 1**.
//
// 가운만 별도 메시를 쓰는 이유 — 2026-08-07 에 실측해 보니 기본 메시의 가운 비율은
// 이미 75% 였는데도 "간호사가 안 보인다"는 피드백이 나왔다. 원인은 비율이 아니라
// **실루엣**이었다. 기본 메시는 크롭탑 + 반바지라, 텍스처를 아무리 희게 칠해도
// "짧은 흰 상의 + 맨다리"로 읽힌다. 그래서 가운은 텍스처가 아니라 모델을 바꾼다.
const VARIANTS = [
  ...Array(20).fill({ model: 'nurse', outfit: 'coat' }),   // 80% — 요청 비율 8:2 유지
  ...Array(2).fill({ model: 'cop', outfit: null }),        //  8% 경찰
  ...Array(2).fill({ model: 'surgeon', outfit: null }),    //  8% 외과의
  { model: 'base', outfit: 'scrub' },                      //  4% 수술복
  { model: 'base', outfit: null },                         //  4% 원본 (피 묻은 셔츠)
];
/** 기본 메시에만 쓰는 텍스처 변형 (가운은 메시 자체가 다르므로 여기 없다) */
const TEX_OUTFITS = ['scrub'];
const TEX_DIR = `${import.meta.env.BASE_URL}assets/textures/`;

const _models = {};        // 'base' | 'nurse' → gltf
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
  for (const name of TEX_OUTFITS) {
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

/**
 * 의료복 재질을 화면에 맞게 다듬는다 (MODEL_FILES 의 `tune` 이 붙은 본체만).
 * 로드 직후 **한 번만** 부른다 —
 * 재질은 개체끼리 공유하므로 여기서 고치면 전부에 반영되고 비용은 0 이다.
 * 이유는 balance.js 의 ZOMBIE_LOOK 주석 참조 (근거리에서 흰 덩어리가 되던 문제).
 */
function tuneGownMaterials(gltf) {
  const [r, g, b] = ZOMBIE_LOOK.gownTint;
  const done = new Set();
  gltf.scene.traverse((o) => {
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const m of mats) {
      if (done.has(m.uuid)) continue;
      done.add(m.uuid);
      m.color?.multiply(new THREE.Color(r, g, b));
      if ('roughness' in m) m.roughness = ZOMBIE_LOOK.gownRoughness;
      if ('metalness' in m) m.metalness = ZOMBIE_LOOK.gownMetalness;
    }
  });
}

/** 게임 시작 전에 부른다. 로딩이 끝나면 대기 중인 좀비들에게 모델이 붙는다. */
export function preloadZombieModel() {
  if (_loading) return _loading;
  const loader = new GLTFLoader();
  // 한쪽이 없어도 게임은 돌아가야 한다 — 가운 모델이 빠지면 기본 메시로 대체된다
  const jobs = Object.entries(MODEL_FILES).map(([key, def]) =>
    loader.loadAsync(`${MODEL_DIR}${def.file}`)
      .then((g) => { _models[key] = g; if (def.tune) tuneGownMaterials(g); })
      .catch((e) => {
        console.warn(`[zombie] ${def.file} 로드 실패 — 이 변형은 기본 메시로 대체합니다.`, e);
      }));
  _loading = Promise.all(jobs).then(() => {
    if (!_models.base) {
      // 기본 메시마저 없으면 캡슐로 간다 (CLAUDE.md §1-2)
      console.warn('[zombie] 기본 GLB 가 없습니다 — 캡슐 대체 메시로 진행합니다.');
      return null;
    }
    _outfitSets = buildOutfits(_models.base);
    for (const fn of _waiters) fn();
    _waiters.length = 0;
    return _models.base;
  });
  return _loading;
}

/** 모델이 준비되면 콜백. 이미 로드됐으면 즉시 호출된다. */
export function requestZombieModel(cb) {
  if (_models.base) { cb(makeInstance()); return; }
  _waiters.push(() => { if (_models.base) cb(makeInstance()); });
  preloadZombieModel();
}

function pick(list, clips) {
  const usable = list.filter((n) => clips.some((c) => c.name === n));
  if (!usable.length) return null;
  return usable[Math.floor(Math.random() * usable.length)];
}

function makeInstance() {
  // 개체마다 변형을 하나 뽑는다 — 전부 같으면 무리가 복제인간으로 보인다
  let v = VARIANTS[Math.floor(Math.random() * VARIANTS.length)];
  // 본체가 없거나, **클립을 빌려올 상대가 없으면** 기본 메시로 떨어진다.
  // (빌리는 쪽만 로드에 성공하면 클립이 하나도 없어 T포즈로 서 있게 된다)
  const lend = MODEL_FILES[v.model]?.clipsFrom;
  if (!_models[v.model] || (lend && !_models[lend])) v = { model: 'base', outfit: v.outfit };
  const src = _models[v.model];

  const root = cloneSkinned(src.scene);
  const outfit = v.outfit;
  // 가운 모델은 이미 흰 가운 텍스처를 갖고 있다 — 갈아끼우면 안 된다
  const set = v.model === 'base' ? _outfitSets?.get(outfit) : null;
  root.traverse((o) => {
    if (o.isMesh || o.isSkinnedMesh) {
      if (set && set.has(o.material.uuid)) o.material = set.get(o.material.uuid);
      o.castShadow = true;
      o.receiveShadow = false;      // 그림자 예산 (CLAUDE.md §3) — 받는 쪽은 레벨이면 충분
      o.frustumCulled = false;      // 스킨 메시는 바운딩박스가 안 따라와서 꺼야 안 사라진다
    }
  });

  const mixer = new THREE.AnimationMixer(root);
  // clipsFrom 이 있으면 그 본체의 클립을 쓴다 (뼈 이름이 같아 그대로 붙는다)
  const from = MODEL_FILES[v.model]?.clipsFrom;
  const clips = (from ? _models[from] : src).animations;

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
  /**
   * 걷기 변형이 둘뿐이라 **클립만으로는 무리가 복제인간으로 보인다.**
   * 클립을 늘리지 않고도 개체를 갈라놓는 세 가지를 개체마다 고정해 둔다.
   *
   *   phase   — 걷기 주기의 시작 지점. 없으면 같은 순간에 걷기 시작한 개체들이
   *             **발을 맞춰 행진한다.** 이게 가장 크게 티가 난다.
   *   lean    — 몸이 한쪽으로 기운 정도. 절뚝이는 실루엣이 개체마다 다르게 읽힌다.
   *   sizeMul — 키. 사람은 원래 제각각이고, 4% 차이도 무리에서는 확실히 보인다.
   *             (피격 판정은 def.height/radius 를 쓰므로 이 값에 안 흔들린다)
   */
  const phase = Math.random();
  const lean = (Math.random() - 0.5) * 0.11;
  const sizeMul = 0.96 + Math.random() * 0.08;
  root.rotation.z = lean;
  return { root, mixer, actions, jitter, outfit, phase, sizeMul };
}
