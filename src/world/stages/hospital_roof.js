/**
 * 구역 E — 옥상 (SPEC.md §3, 마지막 구역)
 *
 * 여기서 규칙이 뒤집힌다. 다섯 구역 내내 천장과 벽으로 시야를 잘라 왔는데,
 * 옥상은 **탁 트여 있다.** 대신 안전하지 않다 — 숨을 곳도 같이 사라진다.
 * 손전등이 멀리 나가지만 비출 벽이 없어서 오히려 아무것도 안 보인다.
 *
 * 구조: 계단탑에서 나옴 → 설비 구역(엄폐물) → 헬리패드 → 탈출 지점
 * 마지막 구역이므로 출구에 닿으면 Game.onClear() → EXTRACTED.
 */

import { EVENTS } from '../../config/balance.js';
import { bus, EV } from '../../core/EventBus.js';
import { makeRng } from '../rng.js';

const WALL_T = 0.25;
const PARAPET_D = 0.3;             // 난간 벽 두께
const DECK_HALF = 15;              // 옥상 반폭 (x: -15 ~ 15)
const DECK_Z0 = -6, DECK_Z1 = 44;  // 옥상 길이
const HUT_Z = -2;                  // 계단탑 중심
const PAD_Z = 32;                  // 헬리패드 중심
const EXIT_Z = 41;

export const meta = {
  id: 'hospital_roof',
  label: '옥상',
  objective: '신호탄을 쏘아 구조를 요청하라',
  // 야외 — 포그를 옅게, 하늘색을 푸르게. 벽이 없어 손전등이 허공을 가른다.
  // ── 옥상은 실내와 다르다 — 달이 떠 있다 (2026-08-08) ──
  // 다섯 구역 내내 손전등에만 의존하면 옥상에 올라온 해방감이 없다. 여기만
  // **완전한 어둠을 풀고** 달빛을 넣는다. 손전등을 꺼도 지형이 읽힌다.
  //
  // 포그 색을 올린 것이 핵심이다. 이전 세션 실측대로 ambient 는 레버가 아니다 —
  // 거리가 있는 픽셀은 전부 포그 색으로 수렴하므로 그 색이 밝기의 바닥을 정한다.
  // 값은 데크(0, 26)에서 네 단계를 찍어 비교하고 골랐다. 먹통 = 휘도 0.02 미만 픽셀.
  //   달빛 없음 63.7% / 1단계 51.1% / **2단계 25.4%** / 3단계 16.7% (탄 픽셀은 전부 0%)
  // 3단계는 바닥이 회색으로 떠서 밤이 아니게 된다. 2단계가 "손전등을 꺼도 다닐 수
  // 있지만 여전히 밤"인 지점이다. (scratchpad/roof_ab.mjs · tools/qa_brightness.mjs)
  mood: {
    fogDensity: 0.019,          // 바깥이라 실내보다 옅다
    fogColor: 0x2a3c52,         // 달빛 머금은 청회색 (0x0b1018 에서 올렸다)
    ambientIntensity: 0.50,
    ambientColor: 0x8fa6c4,     // 푸른 기 — 실내의 형광등 색과 구분된다
    moonIntensity: 0.95,        // 방향광. 난간·실외기에 결이 생긴다
  },
  typeWeights: { shambler: 5, listener: 2, crawler: 3 },
};

export function surfaceAt() { return 'concrete'; }

export function build(ctx) {
  const { addWall, addFloor, addLight, addSpawn, addBlood, addWallBlood,
          scatterDebris, addProp3D, addPropGLB, addSign, addSearchable,
          addLever, triggerWave, setMood, setLights, setExit } = ctx;

  const rnd = makeRng(5150207);

  // ───────── 바닥 · 난간 (천장은 없다 — 이 구역의 정체성) ─────────
  const deckD = DECK_Z1 - DECK_Z0, deckMid = (DECK_Z0 + DECK_Z1) / 2;
  addFloor(0, deckMid, DECK_HALF * 2, deckD);
  addWall(-DECK_HALF, deckMid, PARAPET_D, deckD);
  addWall(DECK_HALF, deckMid, PARAPET_D, deckD);
  addWall(0, DECK_Z0, DECK_HALF * 2, PARAPET_D);
  addWall(0, DECK_Z1, DECK_HALF * 2, PARAPET_D);

  // ───────── 계단탑 (여기로 올라온다) ─────────
  const HUT_W = 9, HUT_D = 8;
  addFloor(0, HUT_Z, HUT_W, HUT_D);
  addWall(-HUT_W / 2, HUT_Z, WALL_T, HUT_D);
  addWall(HUT_W / 2, HUT_Z, WALL_T, HUT_D);
  addWall(0, HUT_Z - HUT_D / 2, HUT_W, WALL_T);
  // 앞면은 문 구멍만 남기고 막는다
  const doorW = 2.0;
  const side = (HUT_W - doorW) / 2;
  addWall(-(doorW / 2 + side / 2), HUT_Z + HUT_D / 2, side, WALL_T);
  addWall(doorW / 2 + side / 2, HUT_Z + HUT_D / 2, side, WALL_T);
  addProp3D('doorFrame', 0, HUT_Z + HUT_D / 2, 0, { args: [2.0, 2.1, 0.35] });
  addProp3D('stairs', 0, HUT_Z - 3.2, 0, { args: [6.0, 6], collide: [6.0, 1.1] });
  addLight(0, 2.6, HUT_Z, 'flicker', 0x2e7a4a);
  addSign(12, 0, 2.3, HUT_Z + HUT_D / 2 - 0.14, Math.PI, 0.9, 0.36, true);
  addSpawn(-3, HUT_Z); addSpawn(3, HUT_Z);

  // ───────── 설비 구역 (z 6 ~ 24) — 유일한 엄폐물 ─────────
  // 옥상에서 살아남으려면 이 사이를 돌며 거리를 벌어야 한다.
  // 큰 설비 블록 — 영안실 서랍벽 모델을 공조기 하우징 대용으로 쓴다 (3.3×2.2m 금속 덩어리).
  // 전용 옥상 설비 모델은 없다. 바꾸려면 tools/import_props.py 에 추가하면 된다.
  for (const [x, z, r] of [[-9.5, 11, 0.2], [9.5, 15, -0.3]]) {
    addPropGLB('prop_morgue_lockers', x, z, r, { collide: [3.3, 2.4] });
  }
  /**
   * 옥상 휴게 공간이 있었다는 흔적 — 자판기 · 벤치.
   *
   * **하나는 눕혀 둔다.** 세 대가 나란히 서 있으면 "배치했다"로 읽히는데,
   * 한 대가 넘어져 있으면 여기서 무슨 일이 있었는지가 읽힌다.
   * `roll` 을 주면 GLB 대신 절차적 자판기가 쓰인다 (StageLoader.addProp3D).
   */
  addProp3D('vendingMachine', -3.6, 8.5, 0.35, { collide: [1.2, 1.0] });
  addProp3D('vendingMachine', 4.5, 8.0, -0.5, { collide: [1.2, 1.0] });
  // 넘어진 자판기. h=1.85 를 눕히면 몸통 중심이 roll 축을 따라 +x 로 0.925 밀리고,
  // 두께의 절반(w/2=0.45)만큼 띄워야 정확히 바닥에 닿는다.
  // yaw(0.22)까지 돌린 실제 중심은 (+0.90, -0.20) 이라 충돌 박스도 그리로 옮긴다 —
  // 부호를 반대로 넣으면 **허공에서 막히고 자판기는 통과된다.**
  addProp3D('vendingMachine', -1.4, 22.9, 0.22, {
    roll: -Math.PI / 2, y: 0.45, collide: [1.95, 1.1], collideAt: [0.9, -0.2],
  });
  // 쏟아져 나온 것들 — 넘어진 자판기 앞에만 잔해를 몰아 준다
  scatterDebris(0.6, 23.4, 3.0, 2.4, 1.1);
  addPropGLB('prop_bench', -6.8, 8.2, 0.12, { collide: [1.6, 0.6] });
  addPropGLB('prop_bench', 7.4, 10.6, Math.PI / 2 + 0.2, { collide: [0.6, 1.6] });
  addPropGLB('prop_panel', -DECK_HALF + 0.45, 10, Math.PI / 2, { collide: [0.5, 0.3] });
  addPropGLB('prop_panel', DECK_HALF - 0.45, 17, -Math.PI / 2, { collide: [0.5, 0.3] });
  // 바리케이드는 문 정면에 두지 않는다 — 나오자마자 시야가 막혀서 방향을 잃는다
  addProp3D('barricade', -7.5, 6.5, 0.15, { args: [5.0, 1.7], collide: [5.0, 0.5] });
  addProp3D('barricade', 8.0, 27.0, -0.2, { args: [4.0, 1.7], collide: [4.0, 0.5] });
  addPropGLB('prop_water_cooler', -6.2, 17.5, 0.8, { collide: [0.4, 0.4] });
  addPropGLB('prop_mop_bucket', 6.4, 15.2, -0.6, { collide: [0.5, 0.5] });
  addProp3D('extinguisher', 2.0, 9.0, 0.3, { collide: [0.3, 0.3] });
  addPropGLB('prop_firstaid', -3.4, 19.6, 0.5);
  addSearchable(-3.4, 19.6, '보급 상자');
  addSearchable(9.0, 19.0, '설비함');

  for (const [x, z] of [[-7, 9], [5, 13], [-1, 20], [8, 23]]) {
    addProp3D('rubblePile', x, z, rnd() * 6.28, { collide: [1.4, 0.9] });
  }

  /**
   * ── 여기까지 환자를 올렸다는 흔적 ──
   *
   * 옥상이 마지막 구역인데 지금까지는 "설비 + 잔해"뿐이라 **병원 옥상이 아니라
   * 그냥 옥상**으로 보였다. 아래 네 층에서 본 물건들이 여기 올라와 있어야
   * 사람들이 환자를 데리고 올라왔다가 실패했다는 것이 읽힌다.
   * 전부 넘어져 있거나 버려진 상태다 — 정돈된 물건은 하나도 두지 않는다.
   */
  addProp3D('gurneyToppled', -5.4, 13.6, 0.9, { collide: [1.6, 1.1] });
  addProp3D('gurneyToppled', 3.2, 24.6, -2.1, { collide: [1.6, 1.1] });
  addProp3D('ivStandFallen', -4.2, 12.2, 1.7);
  addProp3D('ivStandFallen', 6.8, 22.4, -0.4);
  // 뒤집힌 휠체어 — 1F 병실과 같은 방식(roll + y)으로 옆으로 넘어뜨린다
  addProp3D('wheelchair', 2.6, 18.4, rnd() * 6.28, { roll: Math.PI / 2 - 0.12, y: 0.3 });
  // 급히 끌어다 쌓은 의자 줄. 하나는 넘어져 있다
  addProp3D('chairRow', -8.6, 19.2, 0.1, { args: [3], collide: [0.7, 1.9] });
  // 눕히면 원래 **폭**(±0.24)이 높이가 된다. 0.42 로 두면 18cm 떠 버린다.
  // 살짝 잠기는 쪽으로 잡는다 — 떠 있는 것은 눈에 띄고 잠긴 것은 안 띈다.
  addProp3D('chairRow', -7.2, 24.6, 1.5, { args: [2], roll: Math.PI / 2, y: 0.22 });
  // 계단탑 문짝이 뜯겨 앞마당에 떨어져 있다 — 무언가가 밀고 나왔다
  addProp3D('doorFallen', 1.9, 3.4, 0.55, { args: [2.0, 2.05] });
  addProp3D('extinguisher', -2.4, 4.6, 1.2, { roll: Math.PI / 2 - 0.2, y: 0.09 });
  // 옥상 설비 — 환기 유닛. 있어야 할 것이 없으면 옥상으로 안 보인다
  addPropGLB('prop_ventilator', -12.2, 7.4, 0.3, { collide: [1.0, 0.8] });
  addPropGLB('prop_ventilator', 11.8, 24.2, -0.4, { collide: [1.0, 0.8] });
  addPropGLB('prop_trolley', 5.8, 19.8, 2.4, { collide: [0.7, 0.5] });
  addPropGLB('prop_mop_bucket', -10.4, 21.0, 0.4, { collide: [0.5, 0.5] });

  // 여기서 끌려간 흔적. 설비 구역은 지금까지 피 한 방울 없이 깨끗했다
  addBlood(-5.0, 14.6, 2.2, 'drag');
  addBlood(2.2, 23.8, 1.6);
  addBlood(-8.2, 20.0, 1.3, 'splatter');
  addWallBlood(-DECK_HALF + 0.17, 1.15, 13.0, Math.PI / 2, 1.6, 'handprint');
  addWallBlood(DECK_HALF - 0.17, 1.3, 21.0, -Math.PI / 2, 1.8);
  scatterDebris(0, 15, DECK_HALF * 2 - 3, 18, 0.3);
  addLight(-9, 3.4, 12, 'flicker', 0x53402a);
  addLight(8, 3.4, 20, 'pulse', 0x3a4a58);
  // 설비 블록(-9.5,11 / 9.5,15) 안쪽은 피한다 — 좀비가 소품에 박힌다
  addSpawn(-5.5, 10.5); addSpawn(6.0, 10); addSpawn(-6, 22); addSpawn(6, 22);

  // ───────── 헬리패드 (z 32) — 트인 공간. 여기서 마지막 웨이브를 맞는다 ─────────
  addBlood(0, PAD_Z - 3.0, 4.0, 'pool');
  addBlood(2.4, PAD_Z + 1.5, 3.0, 'drag');
  addPropGLB('prop_corpse', -1.6, PAD_Z - 1.0, 0.7);
  addPropGLB('prop_bodybag', 2.2, PAD_Z + 3.4, 1.9);
  // 패드 둘레 유도등 — 어둠 속에서 여기가 목적지임을 알려주는 유일한 표식
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    addProp3D('emergencyLamp', Math.cos(a) * 6.5, PAD_Z + Math.sin(a) * 6.5, -a, { y: 0.9 });
  }
  addLight(0, 3.2, PAD_Z, 'pulse', 0x8a3a2a);
  addSpawn(-7, PAD_Z); addSpawn(7, PAD_Z); addSpawn(0, PAD_Z + 6);
  // 위 3곳은 패드 중심에서 6~7m 라 DIRECTOR.spawnMinDistance(12) 에 걸려 **한 번도 안 쓰인다.**
  // 그래서 패드에 서면 쓸 수 있는 지점이 남쪽 2곳뿐이었고, 마지막 웨이브가 일렬로 들어왔다.
  // 둘레 13~15m 에 링을 둘러 사방에서 올라오게 한다 — 이 구역의 공포는 "도망칠 곳이 없다"다.
  addSpawn(-13, PAD_Z); addSpawn(13, PAD_Z);
  addSpawn(-11.5, EXIT_Z); addSpawn(11.5, EXIT_Z);
  addSpawn(2, PAD_Z - 13);

  // ───────── 탈출 지점 (아직 열리지 않는다) ─────────
  addProp3D('handrail', 0, EXIT_Z, 6, true);
  addSign(12, 0, 2.1, DECK_Z1 - 0.2, Math.PI, 1.2, 0.48, true);
  addWallBlood(0, 1.2, DECK_Z1 - 0.2, Math.PI, 2.0, 'handprint');
  addLight(0, 2.6, EXIT_Z, 'steady', 0x6f8a63);
  scatterDebris(0, EXIT_Z, 10, 5, 0.2);

  // ───────── 사건: 신호탄 → 버티기 → 헬기 ─────────
  // 이 게임의 마지막 장면이다. 지금까지 아껴 온 탄약을 여기서 다 쓰게 만든다.
  // 도망칠 곳이 없는 상태로 시간을 버티는 것이, 계속 도망쳐 온 네 구역과 대비된다.
  const R = EVENTS.roof;
  const timers = [];
  const after = (sec, fn) => timers.push(setTimeout(fn, sec * 1000));

  addLever(0, PAD_Z - 7.0, 0, '신호탄', () => {
    /**
     * ── 쏘는 순간 ──────────────────────────────────────────────────
     * 예전에는 여기가 `setLights('pulse')` 한 줄과 **손전등 클릭음**이 전부였다.
     * 다섯 구역을 지나 도달한 마지막 사건인데 화면에서는 아무 일도 안 일어났다.
     *
     * 셋으로 나눈다 — 쏜다(0초) · 위에서 터진다(boomDelay) · 하늘이 물든다.
     * 발사와 폭발 사이에 간격이 있어야 "쏘아 올렸다"로 읽힌다. 한 번에 터뜨리면
     * 그냥 큰 총소리다.
     */
    bus.emit(EV.SFX, { name: 'flare_launch', volume: 1.0 });
    bus.emit(EV.SHAKE, { amount: R.launchShake });

    after(R.boomDelay, () => {
      bus.emit(EV.SFX, { name: 'flare_boom', volume: R.boomVolume });
      bus.emit(EV.SHAKE, { amount: R.boomShake });
      // 조명은 **터질 때** 바뀐다. 쏠 때 바뀌면 소리보다 빛이 먼저 온다
      setLights('pulse', 1.4);
      setMood({ ...meta.mood, ...R.flareTint });
    });
    // 신호탄이 다 타면 원래 밤으로 돌아간다. meta.mood 를 통째로 넘겨야 한다 —
    // 빠뜨린 값은 applyStageMood 가 기본으로 되돌려서 달빛이 꺼진다
    after(R.boomDelay + R.flareTintSeconds, () => setMood(meta.mood));

    // 주기적으로 몰려온다. 시간이 갈수록 패드 쪽으로 몰리도록 웨이브가 겹친다.
    for (let t = R.waveEvery; t < R.holdSeconds; t += R.waveEvery) {
      after(t, () => triggerWave(R.waveSize));
    }

    // 헬기가 **멀리서부터** 다가온다. 버티는 동안 로터 소리가 커지는 것이
    // "조금만 더"를 만든다. 소리는 헬리패드 쪽에서 난다 — 어디를 봐야 할지 알려준다.
    R.heliCueAt.forEach((left, i) => {
      if (left >= R.holdSeconds) return;
      after(R.holdSeconds - left, () => bus.emit(EV.SFX, {
        name: 'heli_distant', x: 0, z: PAD_Z, volume: R.heliCueVolume[i] ?? 1,
      }));
    });

    bus.emit(EV.OBJECTIVE, { text: `헬기가 올 때까지 ${R.holdSeconds}초 버텨라` });
    for (const left of R.warnAt) {
      if (left >= R.holdSeconds) continue;
      after(R.holdSeconds - left, () => {
        bus.emit(EV.OBJECTIVE, { text: `버텨라 — ${left}초 남음` });
        bus.emit(EV.HINT, { text: `버텨라 — ${left}초`, duration: 2.6 });
      });
    }
    after(R.holdSeconds - 6, () => triggerWave(R.finalWave));

    // 로터 소리가 **도착보다 먼저** 덮친다. 소리가 먼저 와야 헬기가 날아온 것이지,
    // 목표 문구와 동시에 나면 UI 가 알려주는 것이 된다.
    after(Math.max(0, R.holdSeconds - R.heliArriveLead), () => bus.emit(EV.SFX, {
      name: 'heli_arrive', x: 0, z: PAD_Z, volume: R.heliArriveVolume,
    }));

    // 헬기 도착 — 그제야 탈출 지점이 열린다
    after(R.holdSeconds, () => {
      setMood(R.arriveMood);          // 값 전체를 넘긴다 (world.js arriveMood 주석)
      setLights('steady', 1.8);
      bus.emit(EV.OBJECTIVE, { text: '헬기 도착 — 난간 쪽으로' });
      bus.emit(EV.HINT, { text: '헬기 도착 — 난간 쪽으로', duration: 6 });
      setExit({ x: 0, z: EXIT_Z + 1.2, radius: 2.4 });
    });
    // 난간까지 뛰어가는 동안 로터가 계속 돌아야 한다. 파일이 8초라 그보다 짧은
    // 간격으로 겹쳐 튼다 — 끊기면 헬기가 사라진 것처럼 들린다.
    for (let i = 1; i <= R.heliRepeats; i++) {
      after(R.holdSeconds - R.heliArriveLead + R.heliRepeatEvery * i, () => bus.emit(EV.SFX, {
        name: 'heli_arrive', x: 0, z: PAD_Z, volume: R.heliArriveVolume,
      }));
    }

    return `신호탄 발사 — ${R.holdSeconds}초 버텨라`;
  }, '쏘기');

  return {
    playerStart: { x: 0, z: HUT_Z - 1.0, yaw: 0 },   // 계단탑 안에서 시작, 문 쪽(+Z)을 본다
    // exit 없음 — 신호탄을 쏘고 버텨야 열린다 (위 setExit)
    exitWhenReady: { x: 0, z: EXIT_Z + 1.2, radius: 2.4 },
    onUnload: () => { for (const t of timers) clearTimeout(t); },
  };
}
