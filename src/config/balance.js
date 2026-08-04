/**
 * balance.js — 모든 밸런스 수치는 여기에만 존재한다. (CLAUDE.md §1-1)
 * 다른 파일에 매직넘버를 넣지 마라. 값만 고쳐서 게임 느낌을 바꿀 수 있어야 한다.
 * 단위: 거리 = 미터(1 unit = 1m), 시간 = 초
 */

export const WORLD = {
  gravity: 22,
  eyeHeight: 1.7,
  crouchHeight: 1.05,
  playerRadius: 0.35,
};

export const PLAYER = {
  maxHp: 100,
  speedWalk: 2.8,
  speedSprint: 5.2,
  speedCrouch: 1.4,
  accel: 20,          // 가속 (클수록 즉각적). 지수 감쇠라 fps 와 무관하다
  friction: 13,       // 멈출 때 감속. 너무 크면 얼음 위처럼, 너무 작으면 뻑뻑하다
  maxStamina: 100,
  staminaDrain: 18,   // 달릴 때 초당 소모
  staminaRegen: 12,
  staminaMinToSprint: 12,
  mouseSensitivity: 0.0022,
  headBobAmount: 0.035,
  headBobSpeed: 9.5,
  invulnAfterHit: 0.45,
};

export const FLASHLIGHT = {
  maxBattery: 100,
  drain: 1.2,          // 켰을 때 초당 소모
  range: 22,
  angleDeg: 26,
  penumbra: 0.55,
  intensity: 26,       // three.js r155+ 는 물리 단위(칸델라)라 값이 커야 한다. 3.2 는 2m 앞도 못 비췄다

  color: 0xfff0d0,
  flickerBelow: 20,    // 이 % 미만이면 깜빡임
  detectionMultiplier: 1.6, // 켜면 좀비 감지 반경 배수 (핵심 트레이드오프)
};

export const ZOMBIE = {
  // 종류별 정의. Director 가 이 키로 스폰한다.
  shambler: {
    label: '배회체',
    hp: 60,
    speedWander: 1.1,
    speedChase: 3.2,
    damage: 12,
    attackRange: 1.55,
    attackCooldown: 1.1,
    sightRange: 18,
    sightAngleDeg: 100,
    hearRange: 12,
    color: 0x5d6b58,
    radius: 0.38,
    height: 1.75,
    stunResist: 1.0,
  },
  listener: {
    label: '청각체',
    hp: 45,
    speedWander: 1.0,
    speedChase: 4.4,
    damage: 14,
    attackRange: 1.5,
    attackCooldown: 0.9,
    sightRange: 0,        // 눈이 없다 — 소리에만 반응
    sightAngleDeg: 0,
    hearRange: 26,
    color: 0x6b5f58,
    radius: 0.34,
    height: 1.7,
    stunResist: 0.7,
  },
  bloater: {
    label: '비대체',
    hp: 180,
    speedWander: 0.7,
    speedChase: 1.6,
    damage: 26,
    attackRange: 2.0,
    attackCooldown: 1.6,
    sightRange: 14,
    sightAngleDeg: 110,
    hearRange: 14,
    color: 0x4e5a4a,
    radius: 0.55,
    height: 1.9,
    stunResist: 2.4,
  },
};

export const AI = {
  chaseGiveUpTime: 3.0,   // 시야에서 놓친 뒤 추격 유지 시간
  searchTime: 8.0,        // 마지막 목격 지점 수색 시간
  stuckTimeout: 15,       // 이 시간 동안 접근 실패하면 반납 (벽 끼임 방지)
  avoidRayLength: 1.6,
  separation: 0.9,        // 좀비끼리 밀어내는 거리
};

export const NOISE = {
  // 소음 반경 — Director/Zombie 가 이 값으로 유인된다
  walk: 6,
  sprint: 14,
  gunshot: 40,
  gunshotSilenced: 8,
  melee: 10,
  interact: 20,
  generator: 55,
};

export const DIRECTOR = {
  hardCapActive: 14,      // 성능 상한 (디자인 값 아님 — CLAUDE.md §3)
  poolSize: 20,           // 스킨 메시 복제본 수. hardCap 14 + 사망 잔류분이면 충분하다.
                          // 40 이면 로딩 때 스켈레톤을 40벌 만드느라 시작이 느려진다
  spawnMinDistance: 12,   // 플레이어로부터 최소 이 거리
  spawnMaxDistance: 34,
  spawnOnlyOutOfView: true,

  tensionStart: 20,
  tensionMax: 100,
  buildupRate: 4.2,       // 초당 상승
  peakThreshold: 78,
  reliefThreshold: 22,
  peakDecay: 26,          // PEAK 중 초당 하강
  reliefDecay: 14,

  // 페이즈별 동시 활성 목표치 (하드캡 이하에서 움직인다)
  targets: { BUILDUP: 4, PEAK: 12, RELIEF: 1 },
  spawnInterval: { BUILDUP: 2.6, PEAK: 0.7, RELIEF: 99 },
  reliefDuration: 14,

  // 자비 보정 — 플레이어가 힘들면 자동으로 줄인다 (좌절 방지)
  mercyHpThreshold: 35,
  mercyMultiplier: 0.55,
};

export const FX = {
  fogColor: 0x05070a,
  fogDensity: 0.055,       // 실내 기본 (구역별로 StageLoader 가 덮어씀)
  ambientIntensity: 0.055, // 거의 0 — 어둠이 기본이다
  exposure: 0.95,
  emergencyLightColor: 0xff3b2e,
  emergencyLightIntensity: 0.9,
  emergencyLightRange: 7,
};

/** 핏자국 · 의료폐기물 산포 (world/Scatter.js) — 폐병원의 "사람이 있었다"는 증거 */
export const SCATTER = {
  seed: 20290417,          // 고정 시드. 매 판 같은 자리에 있어야 레벨이 안 흔들린다
  bloodRoughness: 0.42,    // 바닥보다 매끈 = 손전등에 젖은 듯 반짝인다

  debrisPerSqm: 0.35,      // 1m² 당 잔해 개수. 0.8 넘으면 쓰레기장처럼 보인다
  debrisMaxTotal: 420,     // 인스턴싱이라 드로우콜은 3개로 고정, 삼각형 예산만 본다
  debrisWeights: { syringe: 5, vial: 3, paper: 2 },

  // 잔해 색 — 바닥이 어두워서 너무 낮추면 아예 안 보인다. 주사기는 반짝여야 눈에 띈다
  syringeColor: 0x5c666d,
  vialColor: 0x49563f,
  paperColor: 0x615c4e,
};

/** 후처리 — 텍스처만큼이나 "게임처럼 보이는가"를 좌우한다 (fx/PostFX.js) */
export const POST = {
  enabled: true,
  bloomStrength: 0.28,     // 손전등 핫스팟·비상등이 번지는 정도
  bloomRadius: 0.7,
  bloomThreshold: 0.85,    // 이 밝기 위만 번진다. 낮추면 전체가 뿌예진다
  grain: 0.03,             // 필름 노이즈. 어두운 곳일수록 강해진다. 0.08 넘으면 화면이 지저분해진다
  vignette: 0.5,           // 화면 가장자리 어둡게 — 시야가 좁아 보인다
  aberration: 0.004,       // 가장자리 색수차. 과하면 싸구려로 보인다
  msaaSamples: 4,
};

export const SURFACE = {
  // 텍스처 한 장이 덮는 실제 크기(m). 작을수록 무늬가 촘촘해진다.
  wallTile: 2.4,
  floorTile: 2.0,
  ceilingTile: 1.2,
  propTile: 0.55,        // 소품은 작아서 벽보다 촘촘해야 결이 보인다

  // 색 보정 — 텍스처는 회색 중립이다. 병원 톤은 여기서 입힌다. (ASSETS.md §3)
  wallTint: 0x7e8c78,      // 병든 institutional green
  floorTint: 0x585d56,
  ceilingTint: 0x4a504a,

  // 요철 세기. 1보다 크면 손전등이 지나갈 때 음영이 강해진다 — 실사감의 핵심
  wallNormalScale: 1.35,
  floorNormalScale: 0.85,
  ceilingNormalScale: 1.0,
  propNormalScale: 0.7,

  anisotropy: 8,           // 바닥을 비스듬히 볼 때의 선명도
  viewModelDim: 0.22,      // 무기 뷰모델 색을 누르는 배수 (손전등 바로 앞이라 안 누르면 탄다)
};

/** 서랍·캐비닛 수색 (world/Interaction.js) — 아포칼립스의 기본 루프 */
export const LOOT = {
  battery: { weight: 44, amount: 35 },    // 손전등 배터리 — 가장 흔하다
  bandage: { weight: 18, heal: 25 },
  empty:   { weight: 38 },                // 헛수고가 있어야 찾는 행위에 긴장이 생긴다
  noise: 12,                              // 뒤지는 소리 반경(m). 좀비가 들을 수 있다
};

export const GAME = {
  difficultyMultiplier: 1.0,  // 0.7 쉬움 / 1.0 보통 / 1.4 어려움
};
