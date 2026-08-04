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
  accel: 14,          // 가속 (클수록 즉각적)
  friction: 11,
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
  intensity: 3.2,
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
  poolSize: 40,
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

export const GAME = {
  difficultyMultiplier: 1.0,  // 0.7 쉬움 / 1.0 보통 / 1.4 어려움
};
