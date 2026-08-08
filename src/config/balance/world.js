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
};


export const GAME = {
  difficultyMultiplier: 1.0,  // 0.7 쉬움 / 1.0 보통 / 1.4 어려움
};
