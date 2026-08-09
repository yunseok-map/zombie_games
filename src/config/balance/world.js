/**
 * 월드·진행 — 치수·전리품·발전기·구역 이벤트·오디오·게임 전반
 *
 * balance.js 에서 갈라져 나왔다. **직접 임포트하지 말고 balance.js 를 임포트한다** —
 * 그쪽이 전부 다시 내보내므로 어느 값이 어느 파일로 갔는지 몰라도 된다.
 * (CLAUDE.md §1-1: 수치는 config/ 안에만 존재한다)
 */


export const WORLD = {
  gravity: 22,
  eyeHeight: 1.7,
  crouchHeight: 1.05,
  playerRadius: 0.35,
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
    // **안 켠 무전기는 가끔 잡음을 낸다.** 병실이 8개인데 무전기는 4개라, 소리가
    // 없으면 절반이 헛걸음이고 어두워서 어느 방을 봤는지도 기억나지 않는다.
    // 라디오니까 잡음이 나는 게 자연스럽고, 벽 너머면 먹먹하게 들려서
    // (AudioManager.occlusionTest) 어느 방인지 소리로 좁혀진다 — 이 게임의 원칙대로
    // 화살표가 아니라 소리로 안내한다.
    staticEvery: 5.5,      // 초. 더 짧으면 잡음이 배경처럼 깔려 단서가 안 된다
    staticVolume: 0.45,
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
 * 발소리 (player/Player.js · enemies/Zombie.js).
 * 재질별 변형 개수. 두 곳이 **같은 표를 읽어야** 한다 — 따로 적어 두면
 * 한쪽만 고치게 되고, 없는 번호를 부르면 조용히 무음이 된다.
 */
export const AUDIO = {
  footstepVariants: { concrete: 4, tile: 4, debris: 3, wet: 2 },

  /**
   * ── 1인칭 플레이어 목소리 (2026-08-08) ──
   *
   * 목소리는 **넣는 것보다 안 넣는 때를 정하는 것이 어렵다.** 휘두를 때마다
   * 기합이 나오면 3분 만에 견딜 수 없어진다. 그래서 전부 확률과 쿨다운을 건다.
   *
   * 볼륨이 좀비 소리보다 낮은 이유 — 이건 **내 목에서 나는 소리**라 3D 감쇠가
   * 없다. 같은 볼륨으로 두면 좀비보다 크게 들려서 긴장이 내 쪽으로 쏠린다.
   */
  voice: {
    // 근접 기합 — 확률로 거른다. 매번 나오면 연타할 때 견딜 수 없다
    effortChance: 0.42,
    effortCooldown: 1.1,      // 초. 연타해도 이 간격보다 촘촘히는 안 난다
    effortVolume: 0.5,
    effortVariants: 3,

    // 물림 — 게임에서 가장 무서운 순간이라 유일하게 크게 낸다
    grabbedVolume: 0.95,
    struggleVolume: 0.6,
    struggleEvery: 0.75,      // 물려 있는 동안 이 간격으로 몸부림 소리
    struggleVariants: 2,

    // 지쳤을 때 — 스태미나가 바닥나면 화면에만 뜨고 귀로는 아무것도 없었다
    breathVolume: 0.55,
    breathEvery: 2.6,         // 지쳐 있는 동안 반복 간격
    breathVariants: 2,

    // 크게 다쳤을 때(부상 2단계) 이따금 나는 신음. 자주 나면 처량하기만 하다
    painVolume: 0.5,
    painEvery: 7.0,
    painVariants: 2,

    // 피격 — 기존 1종에 2종을 더해 3종을 번갈아 쓴다
    hurtVolume: 0.8,
    hurtVariants: 3,
  },
};


export const GAME = {
  difficultyMultiplier: 1.0,  // 0.7 쉬움 / 1.0 보통 / 1.4 어려움
};
