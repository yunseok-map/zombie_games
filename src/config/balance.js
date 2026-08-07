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
  shadowMapSize: 4096, // 씬에서 그림자를 만드는 유일한 광원이라 여기에 예산을 몰아준다.
                       // 1024 면 소품 그림자 가장자리가 계단처럼 끊겨 보인다.
                       // 2048 → 4096 은 측정 +1.2ms. 손전등 원뿔이 좁아 맵 한 장이 담는
                       // 실제 면적이 작으므로, 배수를 올린 만큼 가장자리가 그대로 좋아진다

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
    // 1.1 → 0.8. 걷기 클립의 원래 속도가 0.30~0.46 m/s 라 1.1 을 맞추려면 2.4~3.7 배속이
    // 필요했고, 상한에 걸려 전부 미끄러졌다. 배회는 느릴수록 좋다 —
    // **어슬렁거리다 발견하면 갑자기 달려드는** 낙차가 이 게임의 리듬이다(speedChase 3.2).
    speedWander: 0.8,
    speedChase: 3.2,
    damage: 12,
    attackRange: 1.55,
    attackCooldown: 1.1,
    // 사거리에 들어온 순간 바로 맞으면 "닿았다"가 아니라 "갑자기 깎였다"가 된다.
    // 팔을 드는 시간이 있어야 뒤로 뺄 기회가 생긴다 — 이 값이 곧 반응 시간이다
    attackWindup: 0.30,
    turnRate: 6.6,        // 느리게 돈다. 옆으로 돌아 지나가는 것이 통해야 한다
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
    speedWander: 0.85,   // 배회체와 같은 이유로 낮췄다 (ANIM.clipSpeed 주석 참고)
    speedChase: 4.4,
    damage: 14,
    attackRange: 1.5,
    attackCooldown: 0.9,
    attackWindup: 0.20,   // 빠르다. 붙으면 거의 즉시 온다
    turnRate: 9.5,        // 소리를 따라 홱홱 돈다 — 이 종류만 빠른 회전이 어울린다
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
    attackWindup: 0.34,    // 엎드려서 팔을 뻗는 데 시간이 걸린다
    turnRate: 4.4,        // 기어서 도는 것이라 가장 느리다. 뒤로 빠지면 따돌릴 수 있다
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
    attackWindup: 0.52,   // 크게 휘두른다. 보고 피할 수 있어야 한다
    turnRate: 3.2,
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

/**
 * 피격 반응 (enemies/Zombie.js). 애니메이션만으로는 "닿았다"가 안 느껴진다.
 * 좌표가 아니라 **보이는 위치만** 민다 — 실제로 밀면 벽을 뚫거나 경로가 꼬인다.
 */
export const KNOCK = {
  // 2026-08-07: 0.34 → 0.18 로 줄였다. 맞을 때마다 몸이 훌쩍 밀리니 무게가 없어 보이고,
  // 여러 발을 맞히면 좀비가 뒤로 떠내려간다. 타격감은 히트스톱·화면흔들림·피가 만든다 —
  // **밀림은 거들 뿐인데 키워 놓으면 그것만 눈에 띈다.**
  distance: 0.18,   // 최대 밀림(m)
  duration: 0.20,   // 초. 스턴이 클수록 길어진다
  // 0.26 → 0.15. 젖힘이 크면 발이 바닥을 뚫는다(sin(0.26)x0.19m ≈ 5cm, 알려진 함정).
  // 줄이면 그 문제도 같이 작아진다.
  bend: 0.15,       // 젖혀지는 각도(rad). 맞은 방향으로 젖히고 옆이면 비튼다
};

export const AI = {
  // 좀비가 도는 속도(rad/s). 제한이 없으면 방향이 바뀌는 프레임마다 홱 돌아서
  // 살아 있는 것이 아니라 포탑처럼 보인다. 종류별로 덮어쓸 수 있다(ZOMBIE.*.turnRate)
  turnRate: 7.0,
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
/**
 * 애니메이션 재생 (enemies/Zombie.js).
 * 클립 길이를 게임 수치(쿨다운 등)에 억지로 맞추면 배속이 극단으로 튄다.
 * `tools/qa_motion.js` 로 프레임 단위로 재서 잡은 값들이다.
 */
export const ANIM = {
  // 공격 클립 최대 배속. 예전에는 클립 길이를 쿨다운에 그냥 맞췄는데,
  // 4.5초짜리 클립이 1.1초 쿨다운에 들어가면서 **4.5배속 = 경련**이 나왔다.
  // 상한을 걸면 휘두르는 동작이 쿨다운보다 일찍 끝나지만, 그 편이 훨씬 자연스럽다.
  attackMaxSpeed: 2.0,
  attackMinSpeed: 0.8,
  // 걷기·달리기 재생속도의 하한·상한. 실제 이동속도에 맞춰 조절하되(발이 미끄러지지 않게)
  // 이 범위는 벗어나지 않는다. 하한이 없으면 느리게 도는 순간 슬로모션처럼 발이 끌린다.
  moveMinSpeed: 0.4,
  // 2.2 → 2.4. 남은 걷기 클립 기준 실제로 필요한 최대 배속은 2.13 이다(청각체 x walk_03).
  // 여유를 조금만 둔다 — 크게 열어 두면 배속 이상(경련)을 잡는 QA 검사가 무뎌진다.
  moveMaxSpeed: 2.4,

  /**
   * 클립이 **원래 상정한 이동 속도**(m/s). 배속은 `실제속도 / 이 값` 이다.
   *
   * 예전에는 `실제속도 / 설계속도(speedWander)` 로 잡았다. 그건 **설계속도가 클립의
   * 원래 속도와 같을 때만** 맞는 식인데, 실제로는 0.30~2.08 로 제각각이었다.
   * 그래서 모든 걷기가 상한(2.2)에 걸린 채 다리가 못 따라가고 **그대로 미끄러졌다.**
   *
   * `tools/measure_contact.js` 의 `measureStride()` 로 잰 값이다 —
   * 골반 기준 발의 앞뒤 진폭이 보폭이고, 한 사이클에 두 걸음이 나간다.
   *
   * walk_01 은 여기 없다. **29.87초짜리에 보폭이 사실상 없어(0.06m/s) 걷기 클립이
   * 아니다.** 18배속을 줘야 맞는데 그건 걷는 게 아니다 — 후보에서 뺐다.
   */
  clipSpeed: {
    walk_02: 0.46,
    walk_03: 0.40,
    run: 2.08,
    run_02: 2.08,
  },
  clipSpeedDefault: 1.0,
  // 포복체는 엎드린 공격 클립이 없다. 기는 동작을 빠르게 돌려 달려드는 것처럼 보이게 한다.
  // (선 자세 공격 클립을 쓰면 modelYOffset 때문에 몸이 바닥에 묻힌다)
  crawlerAttackSpeed: 1.9,
};

/**
 * 의료복 계열 본체(방호복·수술복)의 재질 보정.
 *
 * Mixamo 원본은 알베도가 밝아서 손전등을 가까이서 받으면 완전히 날아간다.
 * 실제로 공격 사거리(1.9m)에서 찍어 보니 방호복은 **몸통 주름이 통째로 사라진
 * 흰 덩어리**였다. 3.6m 에서는 멀쩡해서 놓치기 쉬운데, 정작 플레이어가 가장
 * 자주 보는 거리가 1.9m 다. 알베도를 낮추고 거칠기를 올리면 같은 조명에서도
 * 접힘과 주름이 살아난다.
 *
 * 어느 본체에 적용할지는 `ZombieModel.MODEL_FILES` 의 `tune` 표시로 정한다.
 */
export const ZOMBIE_LOOK = {
  // 알베도 배율. 살짝 누렇게 — 갓 꺼낸 새 옷이 아니라 오래 입은 옷으로 보여야 한다
  gownTint: [0.56, 0.55, 0.51],
  gownRoughness: 0.94,   // 번들거림 제거. 천은 거칠다
  gownMetalness: 0.0,
};

/**
 * 좀비 공격의 **타이밍과 감촉**.
 *
 * 예전에는 시계가 두 개였다 — 공격 클립은 제멋대로 루프하고, 데미지는 별도
 * 쿨다운 타이머로 들어갔다. 클립을 스윙마다 되감지 않으니 두 번째 공격부터
 * 위상이 어긋나서, **팔이 회수 중인데 체력이 깎이거나 팔이 관통해도 아무 일이
 * 없었다.** 지금은 스윙 하나가 클립과 데미지를 같이 지배한다.
 */
export const ATTACK = {
  /**
   * 클립에서 팔·다리가 **가장 멀리 뻗는 순간**(0~1). 데미지는 여기서 들어간다.
   *
   * **눈대중 값이 아니다.** `tools/measure_contact.js` 로 네 팔다리(양손·양발)의
   * 전방 도달 거리를 프레임 단위로 재서 최대점을 찾은 값이다.
   * 클립마다 0.20~0.74 로 **3.7배** 벌어진다 — 고정값 하나로는 절대 못 맞춘다.
   * 오른손만 재면 안 된다: 6개 중 3개가 왼손 공격이고 kicking 은 오른발이다.
   */
  contact: {
    attack_01: 0.742,   // 오른손
    attack_02: 0.326,   // 왼손
    attack_03: 0.416,   // 오른손
    attack_04: 0.202,   // 왼손
    attack_05: 0.360,   // 왼손
    kicking: 0.360,     // 오른발 — 도달 0.83m 로 가장 길다
  },
  contactDefault: 0.40,      // 표에 없는 클립(포복체의 crawl 등)

  // 닿는 순간 **좀비 쪽 동작도** 잠깐 멈춘다. 한쪽만 멈추면 부딪힌 게 아니라
  // 맞은 쪽만 경련한 것처럼 보인다. (플레이어 근접에는 이미 있던 장치다)
  hitstop: 0.06,

  // 시각적 런지. **좌표는 안 건드린다** — 벽을 뚫거나 경로가 꼬이면 안 된다.
  // 변환할 때 루트 이동을 지워서 지금은 제자리에서만 휘두른다. 이게 그 보정이다.
  lunge: 0.28,           // 최대 전진량(m)
  lungeBack: 0.35,       // 접촉 후 이만큼의 비율로 되돌아온다

  // 맞으면 카메라가 **맞은 쪽 반대로 밀린다.** 흔들리기만 하면 어디서 맞았는지
  // 몸으로 안 온다. 방향 표시(붉은 물듦)는 머리로 읽는 것이고 이건 몸으로 읽는다.
  camKick: 0.30,         // 밀리는 거리(m)
  camKickPitch: 0.09,    // 동시에 고개가 젖혀지는 양(rad)
  camKickDecay: 6.5,     // 초당 감쇠
};

/**
 * 물림(GRAB) — 좀비가 달라붙는다.
 *
 * 좀비 게임을 좀비 게임으로 만드는 장치. 맞고 체력이 깎이는 것과
 * **붙잡혀서 뿌리쳐야 하는 것**은 완전히 다른 경험이다.
 *
 * 설계 원칙:
 *  - 억울하지 않아야 한다 → 물린 직후엔 쿨다운이 걸려 연속으로 안 물린다.
 *  - 가만히 있으면 절대 안 풀린다 → mashDecay 가 mashGain 보다 크게 잡혀 있다.
 *  - 죽창이 되면 안 된다 → 체력이 낮으면 아예 물지 않는다.
 */
export const GRAB = {
  enabled: true,
  chance: 0.34,          // 공격이 **닿았을 때** 물릴 확률
  cooldown: 8,           // 뿌리친 뒤 이 시간 동안은 아무도 못 문다
  maxSeconds: 3.4,       // 이 안에 못 뿌리치면 강제 해제 + 큰 피해
  dps: 8,                // 물려 있는 동안 초당 피해 (무적시간을 무시한다)
  breakDamage: 18,       // 시간 초과로 풀릴 때 추가 피해
  mashGain: 0.155,       // Space 한 번당 채워지는 양 (약 7번)
  mashDecay: 0.5,        // 초당 빠지는 양 — gain 보다 크게. 가만히 있으면 안 풀린다
  holdDistance: 0.95,    // 좀비가 이 거리까지 끌어당긴다
  lookLerp: 5.5,         // 시야가 좀비 쪽으로 끌리는 속도
  lookFree: 0.5,         // 그래도 이만큼(rad)은 둘러볼 수 있다 — 다 뺏으면 멀미난다
  releaseStun: 1.2,      // 뿌리치면 좀비가 이만큼 경직 — 도망칠 틈이 된다
  releasePush: 1.8,      // 뿌리칠 때 밀려나는 양 — KNOCK.distance(0.34m) 배수. 연출 전용
  minHpRatio: 0.22,      // 체력이 이 비율 아래면 물지 않는다 (물려서 즉사하면 억울하다)
};

/**
 * 무기 스윙 궤적 (weapons/SwingCurves.js).
 * 사람 근접공격 모션(Mixamo)에서 오른손 궤적만 뽑아 뷰모델에 입힌다.
 * 곡선은 진폭 1 로 정규화돼 있으므로 **실제 크기는 여기서 정한다.**
 * 0 으로 두면 곡선을 끄고 기존 절차적 스윙으로 돌아간다.
 */
export const WEAPON_SWING = {
  enabled: true,
  // 근접. 원본 회전 진폭이 300도라 그대로 쓰면 무기가 화면에서 한 바퀴 돈다
  posScale: 0.19,
  rotScale: 0.30,
  // 총기 반동. 훨씬 작게 — 총은 휘두르는 게 아니라 튀는 것이다
  gunPosScale: 0.05,
  gunRotScale: 0.09,
  // 곡선을 얼마나 섞을지. 1 이면 곡선만, 0 이면 기존 절차적 스윙만.
  // 절차적 쪽에 예비동작(뒤로 당김)이 잘 잡혀 있어서 조금 남겨 두는 편이 낫다
  blend: 0.82,
};

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
  // 사망 클립 재생 속도. 원본이 3.0초라 그대로 두면 **너무 느리게 쓰러져 답답하다.**
  // 1.65 배면 1.8초 — 무겁게 넘어가는 느낌은 남기고 늘어지지는 않는다.
  deathSpeed: 1.65,
  // 바닥에 고정하는 시점은 이제 **클립 길이에서 자동으로 구한다**(Zombie.js).
  // 고정값을 쓰면 클립보다 짧을 때 몸이 계속 움직이면서 뼈가 바닥을 뚫는다.
  settleMargin: 0.12,  // 클립이 끝난 뒤 이만큼 더 지켜본 다음 고정한다(초)
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

/**
 * 스텔스 (ui/HUD.js · enemies/Zombie.js).
 * 앉기·손전등·발소리는 처음부터 있었지만 **플레이어가 그 효과를 볼 수 없었다.**
 * 보이지 않는 시스템은 없는 시스템이다 — 아무도 앉지 않는다.
 */
export const STEALTH = {
  noticeCooldown: 2.6,   // 같은 개체가 "눈치챘다" 소리를 연달아 내지 않게(초)
  // 노출도 막대의 경계값. 이 위로 올라가면 색이 바뀐다
  warnAt: 0.55,
  dangerAt: 0.85,
};

export const NOISE = {
  // 소음 반경 — Director/Zombie 가 이 값으로 유인된다
  walk: 6,
  crouchMul: 0.4,   // 앉으면 walk 반경이 이만큼으로 줄어든다. HUD 노출도도 이 값을 쓴다
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
  // 해상도 배율의 천장·바닥·출발점.
  //
  // **천장은 devicePixelRatio 를 넘어도 된다** — 넘으면 크게 그려서 줄이는 것(수퍼샘플링)이
  // 되어 계단이 가장 깨끗하게 사라진다. MSAA 보다 비싸지만 가장자리만이 아니라 화면 전체가
  // 좋아진다 (측정: MSAA2 +3.3ms 로 가장자리만 vs 해상도 1.25배 +7.9ms 로 전부).
  // 천장을 높게 두는 것이 안전한 이유는 **적응형이 실제로 동작하기 때문**이다.
  // 강한 PC 는 여기까지 올라가고, 약한 PC 는 알아서 바닥으로 내려간다.
  pixelRatioMax: 1.75,
  pixelRatioMin: 0.75,     // 적응형이 내려갈 수 있는 바닥
  // 출발점. 천장에서 시작하면 약한 PC 가 첫 몇 초를 버벅이며 연다.
  // 낮게 시작해서 여유가 확인될 때만 올라가는 편이 첫인상이 훨씬 낫다.
  pixelRatioStart: 1.0,

  // 적응형 해상도 — 프레임이 나쁘면 스스로 낮추고, 여유가 있으면 되돌린다.
  // 심사자 PC 를 모르는 상태에서 "안 끊긴다"를 보장하는 유일한 방법이다.
  //
  // **주의**: 이 값들은 PostFX.setSize 가 컴포저의 pixelRatio 를 같이 갱신해야만 의미가 있다.
  // 그 갱신이 빠져 있던 동안에는 배율을 낮춰도 실제 렌더 해상도가 안 변해서 적응형이 무효였다.
  adaptive: true,

  // **이 두 값은 vsync 를 기준으로 읽어야 한다.** 브라우저는 주사율에 맞춰 화면을 내보내므로,
  // 12ms 에 그려도 60Hz 에서는 프레임 간격이 16.7ms 로 측정된다. 그래서 예산을 16.5 로
  // 잡으면 여유가 있어도 "항상 초과"로 읽혀 해상도가 바닥까지 내려가고 다시 안 올라온다.
  //   16.7ms 근처 = vsync 를 지키고 있다 → 여유가 있다는 뜻
  //   20ms 이상   = vsync 를 놓치기 시작했다 → 낮춰야 한다
  frameBudgetMs: 20.0,     // 이보다 오래 걸리면 낮춘다 (60Hz 에서 vsync 를 놓치는 구간)
  frameGoodMs: 17.5,       // 이보다 빠르면 여유가 있다고 본다 (vsync 를 지키고 있다)
  adaptWindow: 1.0,        // 판단에 쓰는 관찰 시간(초). 짧으면 해상도가 출렁인다

  // **비대칭으로, 그리고 수렴하게 조정한다.**
  // 60Hz vsync 에서 프레임 간격은 16.7 아니면 33.3 으로만 튄다 — 중간이 없다.
  // 그래서 조금만 잘못 잡아도 두 값을 오가고, 배율이 바뀔 때마다 렌더 버퍼를 다시
  // 잡느라 그때마다 한 번씩 끊긴다 (측정: 오르내림이 반복되자 33ms 초과가 2 → 38).
  //
  //   많이 초과 → adaptStep 으로 성큼 (버벅임을 빨리 끝내는 게 우선)
  //   조금 초과 → adaptStepFine 으로 한 칸만 (멀쩡한 배율을 지나치지 않게)
  //   여유 있음 → adaptStepUp 으로 한 칸, 그것도 연속 확인 뒤에만
  //   한 번 못 버틴 배율은 기억해 두고 **다시는 그 위로 안 올라간다** → 결국 한 값에 정착한다
  adaptStep: 0.15,         // 많이 초과했을 때 내리는 폭
  adaptStepFine: 0.05,     // 조금 초과했을 때 내리는 폭
  adaptStepUp: 0.05,       // 올릴 때 늘리는 폭
  adaptUpAfter: 4,         // 이만큼 연속으로 여유가 확인돼야 올린다 (adaptWindow 단위)
  adaptBadRatio: 1.5,      // 예산 대비 이 배를 넘으면 "많이 초과"로 본다

  // 이보다 오래 걸린 프레임은 평균에서 뺀다. 셰이더 컴파일·GC 로 한 번 튄 것은
  // "렌더가 무겁다"는 신호가 아닌데, 넣고 세면 시작 직후 스톨 몇 번에 해상도가
  // 바닥까지 내려가고 정착 후에도 안 올라온다 (측정: 0.75 에 눌린 채 76fps).
  stallMs: 50,

  /**
   * 프레임 상한. **분위기를 위한 값이다.** 0 = 상한 없음(브라우저 vsync 에 맡긴다).
   *
   * 기본이 0 인 이유 — vsync 가 이미 주사율로 묶어 준다. 그 위에 상한을 또 걸면
   * 이득 없이 지터만 는다 (측정: 60 상한을 걸자 33ms 초과 프레임이 663 중 2 → 9).
   * 게다가 심사자 모니터를 고를 수 없는데, 120·144Hz 에서 60 은 나눠떨어지지 않아
   * (144/60 = 2.4) 프레임 간격이 불균일해진다.
   *
   * 값을 넣는다면 **주사율의 약수만** 쓸 것:
   *   30 — 영화적 무게감. 60Hz 에서 정확히 2 vsync 라 저더가 없다. 다만
   *        **이 게임에는 모션블러가 없어서** 필름 룩이 아니라 끊김으로 읽힐 수 있고,
   *        1인칭 마우스 조준이라 조준 지연이 커진다. 눈으로 보고 판단할 것.
   *
   * 무게감이 목적이라면 프레임보다 카메라 관성·헤드밥·애니메이션 배속을 먼저 만져라.
   */
  fpsCap: 0,
};

/**
 * 체크포인트 (core/Game.js).
 * 구역이 다섯이고 한 판이 20분 가까이 되는데 죽을 때마다 1구역부터면,
 * **끝을 보는 사람이 거의 없다.** 심사자는 더더욱 그렇다.
 * 공포는 "죽으면 손해가 크다"에서 오지 "20분을 다시 걷는다"에서 오지 않는다.
 */
export const CHECKPOINT = {
  enabled: true,
  // 구역에 들어설 때의 상태로 되돌린다. 다만 빈사로 들어왔다면 그대로 되돌릴 수 없다 —
  // 그러면 죽고 다시 죽는 고리에 갇힌다. 아래 값까지는 올려 준다.
  minHp: 55,
  minBattery: 45,
  minAmmo: 12,        // 권총 예비탄. 0 이면 사건 구간이 통째로 막힌다
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
  seed: 20290417,          // 기본 시드 (randomPerRun 이 false 일 때만 쓴다)

  // **판마다 전리품·잔해 자리를 섞는다.** 같은 자리에서 같은 것이 나오면 두 번째 판부터
  // 탐색이 사라지고 외운 길만 걷게 된다.
  //   무엇이 바뀌나: 수납장에서 나오는 물건 종류, 잔해·핏자국 배치, 소품 각도.
  //   무엇이 안 바뀌나: 벽·문·사건·스폰 지점 — 레벨 구조는 손대지 않는다.
  //     (구조까지 흔들면 QA 로 검증한 동선이 매 판 달라져서 보증할 수 없다)
  randomPerRun: true,
  // 디버깅용 고정 시드. 숫자를 넣으면 randomPerRun 을 무시하고 그 판을 재현한다.
  // 이상한 배치를 발견했을 때 `game.stageLoader.lastSeed` 를 여기 적으면 다시 볼 수 있다.
  forceSeed: null,
  bloodRoughness: 0.42,    // 바닥보다 매끈 = 손전등에 젖은 듯 반짝인다

  debrisPerSqm: 0.35,      // 1m² 당 잔해 개수. 0.8 넘으면 쓰레기장처럼 보인다

  // 병실 내부 밀도. 복도는 사람이 지나가는 곳이라 비어 있어도 되지만, 병실은
  // **사람이 살던 방**이라 비어 있으면 세트장처럼 보인다. 여기만 따로 올린다.
  wardDebris: 0.62,        // 병실 바닥 잔해 밀도 (복도 0.3 대비)
  wardBloodMin: 2,         // 방 하나에 들어가는 핏자국 최소 개수
  wardBloodMax: 4,         // 데칼 하나가 드로우콜 하나다 — 예산(300) 안에서 올린다
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
  // 후처리 버퍼의 MSAA. 4 → 2 → **0**. 그레인·블룸이 가장자리를 어차피 뭉개서
  // 어두운 화면에서는 차이를 거의 못 느끼는데, 약한 GPU 에서는 이게 비싸다.
  // 심사자 PC 를 고를 수 없으므로 안 보이는 품질보다 안 끊기는 쪽을 택한다.
  //   측정(Radeon 780M · 1600x900 · 좀비 14): MSAA2 18.3ms → MSAA0 17.1ms.
  //   계단이 거슬리면 2 로 되돌려라. 대신 프레임 1.2ms 를 낸다.
  msaaSamples: 0,

  // 블룸을 굽는 해상도 배수. 측정해 보니 1.0 과 0.5 의 차이가 0.5ms 라 사실상 공짜였다
  // (UnrealBloomPass 가 내부에서 이미 절반부터 밉을 쌓기 때문). 공짜면 좋은 쪽을 쓴다 —
  // 절반으로 구우면 손전등 핫스팟 둘레에 계단진 번짐이 생긴다.
  bloomScale: 1.0,

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

  // 바닥을 비스듬히 볼 때의 선명도. 8 → 16 (하드웨어 최대치). 측정 +0.4ms 로 거의 공짜인데,
  // 복도를 앞으로 보며 걷는 게임이라 **화면 대부분이 비스듬한 바닥**이다. 체감이 가장 큰 값.
  anisotropy: 16,
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
