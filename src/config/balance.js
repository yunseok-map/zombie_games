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

  // ── 이동감 ──
  // 시야각. 달릴 때 넓어지는 것만으로 속도감의 대부분이 만들어진다.
  // 88 을 넘기면 손전등 원뿔이 화면보다 좁아 보여서 어둠이 답답해진다.
  fov: 75,
  fovSprint: 83,
  fovLerp: 5.5,        // 시야각이 따라붙는 속도. 빠르면 멀미가 난다

  // 옆으로 움직이면 몸이 기운다. 키우면 배를 탄 것처럼 된다
  strafeRoll: 0.026,   // rad
  rollLerp: 6.5,
  // 세로 흔들림 대비 가로 흔들림의 비율. 위아래로만 흔들면 기계가 오르내리는 것 같다 —
  // 사람은 8자를 그리며 걷는다 (가로는 세로의 절반 주기)
  headBobSide: 0.6,
};

export const FLASHLIGHT = {
  maxBattery: 100,
  drain: 1.2,          // 켰을 때 초당 소모
  range: 22,
  angleDeg: 26,
  penumbra: 0.55,
  intensity: 26,       // three.js r155+ 는 물리 단위(칸델라)라 값이 커야 한다. 3.2 는 2m 앞도 못 비췄다
  shadowMapSize: 2048, // 씬에서 그림자를 만드는 유일한 광원이라 여기에 예산을 몰아준다.
                       // 1024 면 소품 그림자 가장자리가 계단처럼 끊겨 보인다

  color: 0xfff0d0,
  flickerBelow: 20,    // 이 % 미만이면 깜빡임
  detectionMultiplier: 1.6, // 켜면 좀비 감지 반경 배수 (핵심 트레이드오프)

  // 빛줄기 속 먼지. 손전등 하나로 버티는 게임이라, 공기가 보이는 것만으로 화면이
  // 크게 달라진다. 0 으로 두면 꺼진다.
  volumeIntensity: 0.55,   // 너무 올리면 눈이 온 것처럼 보인다
  volumeDustSpeed: 1.0,    // 먼지가 떠도는 속도
  dustCount: 1400,         // 입자 수. Points 라 드로우콜은 1이다
  dustField: 26,           // 카메라를 감싸는 정육면체 한 변(m). range 보다 커야 한다
  dustSize: 42,            // 화면상 크기 배수 (거리로 나눈다)
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
    // 사거리에 들어온 순간 바로 맞으면 "닿았다"가 아니라 "갑자기 깎였다"가 된다.
    // 팔을 드는 시간이 있어야 뒤로 뺄 기회가 생긴다 — 이 값이 곧 반응 시간이다
    attackWindup: 0.42,
    turnRate: 4.2,        // 느리게 돈다. 옆으로 돌아 지나가는 것이 통해야 한다
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
    attackWindup: 0.28,   // 빠르다. 붙으면 거의 즉시 온다
    turnRate: 7.0,        // 소리를 따라 홱홱 돈다 — 이 종류만 빠른 회전이 어울린다
    sightRange: 0,        // 눈이 없다 — 소리에만 반응
    sightAngleDeg: 0,
    hearRange: 26,
    color: 0x6b5f58,
    radius: 0.34,
    height: 1.7,
    stunResist: 0.7,
  },
  crawler: {
    // 다리를 잃고 기어 온다. 느리지만 **낮아서 늦게 보인다** — 손전등은 앞을 비추지
    // 바닥을 비추지 않는다. 복도에서 발밑을 확인하게 만드는 것이 이 타입의 목적이다.
    label: '포복체',
    hp: 40,
    speedWander: 0.6,
    speedChase: 2.4,
    damage: 15,          // 느린 대신 한 대가 아프다. 붙으면 떨어뜨리기 어렵다
    attackRange: 1.35,
    attackCooldown: 1.2,
    attackWindup: 0.5,    // 엎드려서 팔을 뻗는 데 시간이 걸린다
    turnRate: 2.6,        // 기어서 도는 것이라 가장 느리다. 뒤로 빠지면 따돌릴 수 있다
    sightRange: 13,
    sightAngleDeg: 90,
    hearRange: 16,
    color: 0x5a5f50,
    radius: 0.42,        // 엎드려서 옆으로 넓다
    height: 0.6,         // 피격 판정·시야 높이. 모델 크기가 아니다
    modelScale: 1.0,     // 몸집은 다른 좀비와 같다. height 로 줄이면 미니어처가 된다
    modelYOffset: -0.62, // 루트 수직 이동을 지운 탓에 뜨는 만큼 내린다 (화면 보고 맞춘 값)
    crawler: true,       // Zombie._animKey() 가 이걸 보고 crawl 클립을 쓴다
    stunResist: 0.8,
  },
  bloater: {
    label: '비대체',
    hp: 180,
    speedWander: 0.7,
    speedChase: 1.6,
    damage: 26,
    attackRange: 2.0,
    attackCooldown: 1.6,
    attackWindup: 0.72,   // 크게 휘두른다. 보고 피할 수 있어야 한다
    turnRate: 1.9,
    sightRange: 14,
    sightAngleDeg: 110,
    hearRange: 14,
    color: 0x4e5a4a,
    radius: 0.55,
    height: 1.9,
    stunResist: 2.4,
  },
};

/**
 * 피격 반응 (enemies/Zombie.js). 애니메이션만으로는 "닿았다"가 안 느껴진다.
 * 좌표가 아니라 **보이는 위치만** 민다 — 실제로 밀면 벽을 뚫거나 경로가 꼬인다.
 */
/**
 * 카메라 흔들림 · 히트스톱 (player/Player.js · core/Game.js).
 * 넉백·핏자국은 **맞는 쪽**의 반응이고, 이건 **때리는 쪽·맞는 쪽 모두의 손맛**이다.
 * 이게 없으면 총을 쏘든 파이프로 치든 화면이 가만히 있어서 전부 물렁하게 느껴진다.
 */
export const SHAKE = {
  // trauma 를 더하고 제곱해서 쓴다 — 약할 때는 티가 안 나고 셀 때 확 온다
  gunshot: 0.40,
  melee: 0.30,       // 휘두를 때가 아니라 **닿았을 때**만
  hurt: 0.62,
  decay: 2.8,        // 초당 trauma 감소. 크면 툭 끊기고, 작으면 계속 흔들려 멀미가 난다
  maxPos: 0.05,      // 위치 흔들림 최대(m)
  maxAngle: 0.032,   // 회전 흔들림 최대(rad)
  freq: 24,          // 흔들림 주파수(Hz). 낮으면 배 멀미, 높으면 지직거림
  hitStop: 0.055,    // 근접이 닿는 순간 멈추는 시간(초). 0.1 을 넘기면 렉으로 느껴진다
};

export const KNOCK = {
  distance: 0.34,   // 최대 밀림(m). 0.6 넘으면 몸이 미끄러지는 것처럼 보인다
  duration: 0.20,   // 초. 스턴이 클수록 길어진다
  bend: 0.26,       // 젖혀지는 각도(rad). 맞은 방향으로 젖히고 옆이면 비튼다
};

export const AI = {
  // 좀비가 도는 속도(rad/s). 제한이 없으면 방향이 바뀌는 프레임마다 홱 돌아서
  // 살아 있는 것이 아니라 포탑처럼 보인다. 종류별로 덮어쓸 수 있다(ZOMBIE.*.turnRate)
  turnRate: 5.0,
  chaseGiveUpTime: 3.0,   // 시야에서 놓친 뒤 추격 유지 시간
  searchTime: 8.0,        // 마지막 목격 지점 수색 시간
  stuckTimeout: 15,       // 이 시간 동안 접근 실패하면 반납 (벽 끼임 방지)
  avoidRayLength: 1.6,
  separation: 0.9,        // 좀비끼리 밀어내는 거리
};

/**
 * 좀비 발소리 (enemies/Zombie.js).
 * **보이기 전에 들린다** — 이 게임에서 가장 값싸고 가장 무서운 장치다(SPEC.md §5: 소리 > 시각).
 * 다만 14마리가 동시에 밟으면 소리가 뭉개져서 오히려 정보가 사라진다. 그래서 거리로 자른다.
 */
export const ZOMBIE_STEP = {
  stride: 1.5,          // 이 거리를 움직일 때마다 한 걸음
  maxDistance: 16,      // 이 밖에서는 아예 내지 않는다
  volume: 0.32,         // 플레이어 발소리(0.52)보다 작게 — 내 발소리를 덮으면 안 된다
  rate: 0.76,           // 사람보다 낮게. 같은 파일도 느리면 무겁게 들린다
  crawlerRate: 0.58,    // 포복체는 끄는 소리에 가깝게 더 낮게
};

/**
 * 시체 (enemies/Zombie.js). 죽자마자 사라지면 "게임이구나" 소리가 절로 난다.
 * 다만 풀(DIRECTOR.poolSize)을 시체가 다 차지하면 새 좀비가 안 나오므로,
 * 자리가 모자라면 ZombiePool 이 가장 오래된 시체부터 재활용한다.
 */
export const CORPSE = {
  linger: 30,        // 쓰러진 뒤 남아 있는 시간(초)
  sink: 1.4,         // 마지막 이 시간 동안 바닥으로 가라앉으며 사라진다
  sinkDepth: 0.9,    // 가라앉는 깊이(m). 얕으면 사라지는 게 눈에 띈다
  bloodSize: 2.2,    // 죽은 자리에 남는 핏자국 크기(m)
  settleAt: 1.6,     // 쓰러지는 동작이 끝나 바닥에 붙이는 시점(초). 클립 길이보다 길게
  restHeight: 0.06,  // 바닥에 붙일 때 띄우는 높이(m). 0이면 몸이 바닥에 파묻힌다
};

/**
 * 피격 시 튀는 피 (fx/Impact.js).
 * 소리와 애니메이션만으로는 "닿았다"가 약하다. 맞은 자리에서 뭔가 튀어야 한다.
 * 입자를 미리 만들어 돌려쓴다 — 드로우콜 1개.
 */
export const IMPACT = {
  count: 260,        // 풀 크기. 동시에 여러 마리를 때려도 모자라지 않을 만큼
  perHit: 14,        // 한 대당 튀는 입자 수
  color: 0x7c1512,   // 어두운 적갈색. 밝으면 페인트처럼 보인다
  speed: 2.6,        // 맞은 방향으로 날아가는 속도(m/s)
  spread: 2.2,       // 좌우로 흩어지는 정도
  up: 2.4,           // 위로 튀는 속도. 옆으로만 튀면 물총처럼 보인다
  gravity: 11,
  life: 0.55,        // 초. 길면 공중에 오래 떠 있어 가짜로 보인다
  sizeMin: 0.8, sizeMax: 2.1,
  pixelScale: 26,    // 화면상 크기 배수 (거리로 나눈다)
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

/**
 * 성능 — **심사자의 PC 사양을 고를 수 없다.** 웹 링크로 제출하므로 사무용 노트북의
 * 내장 그래픽에서 열릴 수도 있다. 그래서 "내 PC에서 60fps"가 아니라
 * "약한 PC에서도 안 끊긴다"가 기준이다.
 */
export const PERF = {
  // 렌더 해상도 배율 상한. devicePixelRatio 2 인 노트북에서 2 로 두면 픽셀을 4배 그린다 —
  // 후처리까지 그 해상도로 도니 가장 큰 낭비였다. 1.5 면 선명함은 거의 그대로다.
  pixelRatioMax: 1.5,
  pixelRatioMin: 0.75,     // 적응형이 내려갈 수 있는 바닥

  // 적응형 해상도 — 프레임이 나쁘면 스스로 낮추고, 여유가 있으면 되돌린다.
  // 심사자 PC 를 모르는 상태에서 "안 끊긴다"를 보장하는 유일한 방법이다.
  adaptive: true,
  frameBudgetMs: 20.0,     // 이보다 오래 걸리면 낮춘다 (50fps. 60 을 기준하면 너무 예민하다)
  frameGoodMs: 13.0,       // 이보다 빠르면 되돌린다
  adaptWindow: 1.4,        // 판단에 쓰는 관찰 시간(초). 짧으면 해상도가 출렁인다
  adaptStep: 0.15,         // 한 번에 조정하는 배율
};

export const FX = {
  fogColor: 0x05070a,
  fogDensity: 0.055,       // 실내 기본 (구역별로 StageLoader 가 덮어씀)
  ambientIntensity: 0.055, // 거의 0 — 어둠이 기본이다
  exposure: 0.95,
  // 환경맵 세기. 금속·유리가 형태를 읽히게 하는 정도만 — 올리면 어둠이 걷힌다
  envIntensity: 0.16,
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
  // 후처리 버퍼의 MSAA. 4 → 2 로 낮췄다 — 그레인·블룸이 가장자리를 어차피 뭉개서
  // 어두운 화면에서는 차이를 거의 못 느끼는데, 약한 GPU 에서는 이게 비싸다.
  // 심사자 PC 를 고를 수 없으므로 안 보이는 품질보다 안 끊기는 쪽을 택한다.
  msaaSamples: 2,

  // 앰비언트 오클루전. 소품이 바닥에 닿아 보이게 하지만 **이 게임에서는 너무 비싸다.**
  //   측정(2F + 좀비 14): 14.5ms → 30.2ms. 해상도를 절반으로 낮춰도 29.5ms 로 거의 그대로다.
  //   비용이 해상도가 아니라 깊이·노멀 프리패스(씬을 한 번 더 그린다)에 있기 때문이고,
  //   스킨 메시 14개가 두 번 렌더되는 순간 60fps 예산이 깨진다.
  // 좀비 수를 줄이거나 고사양만 노린다면 true 로 켜면 된다.
  ao: false,
  aoRadius: 0.28,      // m. 크게 잡으면 벽 전체가 지저분하게 어두워진다
  aoStrength: 1.1,
  aoSamples: 8,        // 낮추면 얼룩이 생기고, 높이면 프레임을 먹는다
  aoScale: 0.5,        // AO 를 굽는 해상도 배수. 1.0 은 프레임을 배로 먹는다
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

  // 외부 GLB 소품(world/PropModels.js). Sketchfab 재질은 밝은 실내등 기준이라
  // 손전등(26cd) 아래에서는 그대로 쓰면 하얗게 탄다. 텍스처는 살리고 색만 누른다.
  propModelDim: 0.55,
  propModelRoughMin: 0.45,   // 너무 반질거리면 손전등 반사가 점으로 튄다
  propModelMetalMax: 0.55,   // 환경맵이 생겨서 예전(0.35)보다 금속을 살려도 된다
  propModelEnv: 1.0,         // 소품의 환경맵 반사 세기 (전체 세기는 FX.envIntensity)
};

/** 서랍·캐비닛 수색 (world/Interaction.js) — 아포칼립스의 기본 루프 */
export const LOOT = {
  battery: { weight: 40, amount: 35 },    // 손전등 배터리 — 가장 흔하다
  bandage: { weight: 18, heal: 25 },
  // 9mm 탄약. 시작 48발이 전부였고 보급이 없어서, 옥상 90초를 총으로 버티는 것이
  // 애초에 불가능했다 (필요 ~2600 피해 vs 탄약 1632). 수색해야 총을 쓸 수 있게 한다.
  ammo:    { weight: 26, amount: 10, weaponId: 'pistol' },
  empty:   { weight: 30 },                // 헛수고가 있어야 찾는 행위에 긴장이 생긴다
  noise: 12,                              // 뒤지는 소리 반경(m). 좀비가 들을 수 있다
};

/**
 * 부상 — 체력이 곧 상태다. 숫자만 줄지 말고 몸이 말을 안 들어야 무력감이 산다.
 * (SPEC.md §1 핵심 감정: 무력함 → 잠깐의 안도 → 다시 무력함)
 */
export const INJURY = {
  limpBelow: 0.5,        // 이 비율 아래면 절뚝인다
  crippledBelow: 0.25,   // 이 아래면 심각
  sprintLockBelow: 0.2,  // 이 아래면 달릴 수 없다

  moveMul:  [1.0, 0.74, 0.56],   // 부상 단계별 이동속도 배수
  meleeMul: [1.0, 0.70, 0.45],   // 팔에 힘이 빠진다 — 근접 데미지 배수
  swayMul:  [1.0, 1.9, 3.0],     // 시야·조준 흔들림
  limpDip: 2.3,                  // 한쪽 발에서만 더 깊게 꺼진다 (절뚝임)
  limpRoll: 0.035,               // 걸을 때 몸이 기우는 각도(rad)
};

/** 구역 B 발전기 복구 이벤트 (SPEC.md §3) */
export const GENERATOR = {
  leverCount: 3,
  waveOnLever: 4,        // 레버 하나당 불러오는 좀비 수
  waveOnComplete: 9,     // 3개 완료 직후 대규모 웨이브
  reliefSeconds: 2.2,    // 불이 켜지고 안도하는 시간. 그 다음이 진짜다
  litAmbient: 1.15,      // 복구 후 앰비언트. 0.4 대로는 화면에서 "켜졌다"가 안 읽힌다 —
                         // 이 2초의 안도가 뒤이은 웨이브의 낙차를 만든다
  litFog: 0.022,
};

/**
 * 구역별 사건 (SPEC.md §3). 각 구역에 "그 구역만의 일"이 하나씩 있어야
 * 다섯 구역이 같은 복도의 반복으로 느껴지지 않는다.
 */
export const EVENTS = {
  // 2F — 병실 무전기. 켤 때마다 소리가 나고, 다 켜야 계단실이 열린다.
  ward: {
    radioCount: 4,
    waveOnRadio: 3,        // 무전기 하나당. 발전기 레버(4)보다 약하게 — 여긴 중반이다
    waveOnComplete: 7,
  },
  // 3F — 수술부 봉쇄. 무영등 2개에 전원을 넣어야 봉쇄문이 풀린다.
  surgery: {
    lampCount: 2,
    waveOnLamp: 5,         // 수술실은 좁아서 같은 수가 더 위협적이다
    waveOnComplete: 8,
  },
  // 옥상 — 신호탄을 쏘고 헬기가 올 때까지 버틴다. 마지막 구역이라 가장 길다.
  roof: {
    holdSeconds: 90,       // 버티는 시간. 여기서 모아 온 탄약을 다 쓰게 된다
    waveEvery: 15,         // 몇 초마다 웨이브가 오는가
    waveSize: 5,
    finalWave: 10,         // 헬기 도착 직전 마지막
    warnAt: [60, 30, 10],  // 남은 시간 알림(초). 카운트다운이 보여야 버틸 맛이 난다
  },
};

/**
 * GLB 무기 뷰모델의 배치. 모델마다 축·원점이 달라서 값으로 맞춘다.
 * (Kenney CC0 킷은 Y-up · 원점이 바닥이라 눕히고 앞으로 밀어야 한다)
 */
export const WEAPON_VIEW = {
  // Kenney 모델은 원본이 작다 (도끼 0.267m). 실물 크기로 키워야 한다 —
  // 안 그러면 손에 장난감을 든 것처럼 보인다.
  //   rot X = -90°  : 원본이 Y 로 서 있으므로 눕혀서 -Z(정면)로 향하게
  axe:     { scale: 2.55, rot: [-Math.PI / 2, 0.28, 0.10], pos: [0, 0.02, -0.02] },
  molotov: { scale: 1.70, rot: [-Math.PI / 2, 0.30, 0.00], pos: [0, -0.02, -0.02] },

  // Sketchfab 3종 — 이미 실물 크기(m)라 scale 은 1 이다. 원점은 물체 중심.
  //   pipe·crowbar : 원본이 Y 로 서 있다 → X -90° 로 눕혀 -Z(정면)를 향하게
  //   pistol       : 원본이 X 로 누워 있다 → Y 로 돌려 총구를 -Z 로
  // colorMul 은 개별로 준다 — Kenney(민무늬 회색)와 달리 PBR 텍스처가 있어서
  // 0.12 로 누르면 새까매진다.
  pipe:    { scale: 1.00, rot: [-Math.PI / 2, 0.34, 0.14], pos: [0.02, -0.02, -0.06], colorMul: 0.60 },
  crowbar: { scale: 1.00, rot: [-Math.PI / 2, 0.36, 0.12], pos: [0.02, -0.02, -0.10], colorMul: 0.60 },
  pistol:  { scale: 1.00, rot: [0, -Math.PI / 2, 0.04], pos: [0, 0.05, -0.04], colorMul: 0.55 },
  // GLB 재질은 밝은 회색(c0c0c0). 손전등이 0.45m 앞에서 26cd 라
  // 알베도 0.09 정도로도 클리핑된다. 화면 보고 이 값만 조절하면 된다.
  colorMul: 0.12,
};

/**
 * 총구 화염 (weapons/WeaponSystem.js).
 * 칠흑 속에서 총을 쏘면 한순간 주변이 전부 드러나야 한다. 이게 없으면
 * 소리만 나고 화면은 그대로라 "쐈다"는 감각이 안 산다.
 * 그림자는 만들지 않는다 — 그림자 광원은 손전등뿐이다 (CLAUDE.md §3).
 */
export const MUZZLE = {
  color: 0xffd9a0,
  intensity: 420,     // 손전등(26)보다 훨씬 세다. 한 프레임짜리라 눈이 안 아프다
  range: 16,
  duration: 0.065,    // 초. 길면 손전등이 하나 더 생긴 것처럼 보인다
};

export const GAME = {
  difficultyMultiplier: 1.0,  // 0.7 쉬움 / 1.0 보통 / 1.4 어려움
};
