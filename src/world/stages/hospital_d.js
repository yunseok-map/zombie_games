/**
 * 구역 D — 3F 수술부 · 중환자실 (SPEC.md §3)
 *
 * 마지막 실내 구역. 여기서는 **좁음**이 공포다.
 * 수술실은 문이 하나뿐이라 들어가면 물러설 곳이 없고,
 * 중환자실은 커튼 칸막이가 줄지어 있어 시야가 계속 끊긴다.
 *
 * 구조: 진입 계단실 → 수술부 복도 → (좌) 수술실 2 · (우) 중환자실 → 옥상 계단실
 */

import { EVENTS, SCATTER } from '../../config/balance.js';
import { bus, EV } from '../../core/EventBus.js';
import { makeRng } from '../rng.js';

const WALL_T = 0.2;
const HALL_HALF = 2.6;
const HALL_Z0 = 4, HALL_Z1 = 34;
const ROOM_X = 11;
const ENTRY_Z = 0, EXIT_Z = 38;
const OR_Z = [12, 26];             // 수술실 중심 z
const OR_D = 10;                   // 수술실 깊이

export const meta = {
  id: 'hospital_d',
  label: '3F 수술부 · 중환자실',
  objective: '수술실 무영등 2개에 전원을 넣어라',
  // 수술등이 아직 몇 개 살아 있어 A~C 중 가장 밝다. 대신 그림자가 길다.
  mood: { fogDensity: 0.05, fogColor: 0x070808, ambientIntensity: 0.045 },
  // 2F 와 같은 이유로 살짝만 올린다 (hospital_c.js 의 poweredMood 주석 참고)
  poweredMood: { ambientIntensity: 0.09, fogDensity: 0.044 },
  poweredBoost: 1.3,
  typeWeights: { shambler: 4, listener: 3, crawler: 2 },
};

export function surfaceAt() { return 'tile'; }

export function build(ctx) {
  const { addWall, addFloor, addCeiling, addLight, addSpawn, addBlood, addWallBlood,
          scatterDebris, addProp3D, addPropGLB, addSign, addSearchable, addWeapon,
          addLever, addDoor, triggerWave, setMood, setLights } = ctx;

  const rnd = makeRng(771013);
  const trim = (cx, cz, len, horizontal) => {
    addProp3D('baseboard', cx, cz, 0, { args: [len, horizontal] });
    addProp3D('handrail', cx, cz, 0, { args: [len, horizontal] });
  };

  // ───────── 진입 계단실 ─────────
  addFloor(0, ENTRY_Z, 9, 8); addCeiling(0, ENTRY_Z, 9, 8);
  addWall(-4.5, ENTRY_Z, WALL_T, 8);
  addWall(4.5, ENTRY_Z, WALL_T, 8);
  addWall(0, ENTRY_Z - 4, 9, WALL_T);
  addProp3D('stairs', 0, ENTRY_Z - 3.4, 0, { args: [6.0, 6], collide: [6.0, 1.1] });
  addLight(0, 2.85, ENTRY_Z, 'steady', 0x2e7a4a);
  addSign(12, 0, 2.35, ENTRY_Z - 3.9, 0, 0.9, 0.36, true);
  const gap = (9 - HALL_HALF * 2) / 2;
  addWall(-(HALL_HALF + gap / 2), 4, gap, WALL_T);
  addWall(HALL_HALF + gap / 2, 4, gap, WALL_T);
  addSpawn(-3.2, ENTRY_Z); addSpawn(3.2, ENTRY_Z);

  // ───────── 수술부 복도 ─────────
  const hallLen = HALL_Z1 - HALL_Z0;
  const hallMid = (HALL_Z0 + HALL_Z1) / 2;
  addFloor(0, hallMid, HALL_HALF * 2, hallLen);
  addCeiling(0, hallMid, HALL_HALF * 2, hallLen);

  // 왼쪽 벽 — 수술실 문 2개. 오른쪽 벽 — 중환자실 입구 하나(넓다)
  {
    let z = HALL_Z0;
    for (const dz of OR_Z) {
      const seg = dz - 0.9 - z;
      if (seg > 0.1) addWall(-HALL_HALF, z + seg / 2, WALL_T, seg);
      addProp3D('doorFrame', -HALL_HALF, dz, Math.PI / 2, { args: [1.8, 2.1, 0.3] });
      // 수술실 문은 한쪽만 크게 열려 있다 — 안이 반쯤 보여서 들어가기 전에 망설이게 된다
      addProp3D('doorPanel', -HALL_HALF, dz + 0.9, Math.PI / 2 - 1.55,
        { args: [1.72, 2.05] });
      z = dz + 0.9;
    }
    const last = HALL_Z1 - z;
    if (last > 0.1) addWall(-HALL_HALF, z + last / 2, WALL_T, last);
  }
  {
    const icuDoorZ = 19, icuDoorW = 3.0;
    const a = icuDoorZ - icuDoorW / 2 - HALL_Z0;
    addWall(HALL_HALF, HALL_Z0 + a / 2, WALL_T, a);
    const b = HALL_Z1 - (icuDoorZ + icuDoorW / 2);
    addWall(HALL_HALF, HALL_Z1 - b / 2, WALL_T, b);
    addProp3D('doorFrame', HALL_HALF, icuDoorZ, Math.PI / 2, { args: [3.0, 2.2, 0.3] });
  }
  for (const cz of [8, 17, 26, 33]) {
    trim(-(HALL_HALF - 0.12), cz, 5, false);
    trim(HALL_HALF - 0.12, cz, 5, false);
    addProp3D('ceilingLight', 0, cz, 0, { y: 3.1, args: [cz === 17] });
    if (cz !== 17) addLight(0, 2.9, cz, 'flicker', 0x44555e);
  }
  addPropGLB('prop_trolley', -1.5, 9.5, 0.4, { collide: [0.6, 0.6] });
  addPropGLB('prop_trolley', 1.4, 30.0, -0.3, { collide: [0.6, 0.6] });
  addPropGLB('prop_corpse', -0.9, 21.5, 2.4);
  addBlood(-0.9, 21.8, 3.2, 'pool');
  addBlood(0.7, 15.0, 2.6, 'drag');
  addWallBlood(-HALL_HALF + 0.12, 1.4, 24.0, Math.PI / 2, 1.8, 'handprint');
  scatterDebris(0, hallMid, HALL_HALF * 2 - 0.4, hallLen, 0.24);

  // ───────── 좌: 수술실 2개 ─────────
  const orCx = -(HALL_HALF + (ROOM_X - HALL_HALF) / 2);
  const orW = ROOM_X - HALL_HALF;

  OR_Z.forEach((cz, i) => {
    addFloor(orCx, cz, orW, OR_D); addCeiling(orCx, cz, orW, OR_D);
    addWall(-ROOM_X, cz, WALL_T, OR_D);
    addWall(orCx, cz - OR_D / 2, orW, WALL_T);
    addWall(orCx, cz + OR_D / 2, orW, WALL_T);
    // 15번은 **기계실 B1** 명패다 — 수술실 문에 붙어 있었다. 3번이 처치실이다.
    // 두 수술실 중 하나는 명패가 비뚤어져 있다
    addSign(3, -HALL_HALF + 0.11, 1.66, cz - 1.4, Math.PI / 2, 0.45, 0.18,
      false, i === 1 ? -0.42 : 0);

    // 수술대 + 무영등. 수술등은 천장에 매단다.
    addPropGLB('prop_autopsy_table', orCx, cz, i === 0 ? 0.1 : -0.15, { collide: [2.0, 0.9] });
    addPropGLB('prop_surgical_lamp', orCx, cz - 0.4, 0, { y: 2.35 });
    addPropGLB('prop_ventilator', orCx + 2.2, cz - 2.6, 0.6, { collide: [0.65, 0.65] });
    addPropGLB('prop_trolley', orCx - 1.9, cz + 1.6, rnd() * 6.28, { collide: [0.6, 0.6] });
    addPropGLB('prop_sink', -ROOM_X + 0.5, cz + 3.4, Math.PI / 2, { collide: [0.6, 0.7] });
    addProp3D('cabinet', -ROOM_X + 0.6, cz - 3.6, Math.PI / 2, { collide: [0.7, 0.85] });
    addSearchable(-ROOM_X + 1.4, cz - 3.6, '기구 수납장');
    // 소방도끼는 첫 수술실 앞 복도에만 하나 둔다. 근접의 최종 보상 —
    // 55 피해라 배회체(60)를 두 방에 끝낸다. 대신 느리고 기절이 거의 없다
    if (i === 0) addWeapon(HALL_HALF - 0.9, cz - 1.0, 'axe', '소방도끼');
    // 화염병 — 여기서 처음 준다. 다음이 옥상 90초 농성이라, **좁은 길목을 잠그는**
    // 도구를 그 직전에 쥐어 줘야 쓸 자리를 스스로 찾게 된다.
    // 2개뿐이라 옥상까지 아껴 갈지 여기서 쓸지가 곧 판단이 된다.
    if (i === 1) addWeapon(-ROOM_X + 1.4, cz + 3.4, 'molotov', '화염병');

    addBlood(orCx, cz + 1.2, 3.4, 'pool');
    addBlood(orCx - 1.4, cz - 1.8, 2.2, 'splatter');
    scatterDebris(orCx, cz, orW - 1.6, OR_D - 1.6, 0.3);
    addLight(orCx, 2.8, cz, i === 0 ? 'steady' : 'flicker', 0x5a6a72);
    // 방 중앙은 수술대가 차지한다 — 거기 스폰하면 좀비가 소품 안에 박힌다
    addSpawn(orCx - 2.6, cz + 3.0);
  });

  // ───────── 우: 중환자실 (한 덩어리 큰 방) ─────────
  const icuCx = HALL_HALF + (ROOM_X - HALL_HALF) / 2;
  const icuW = ROOM_X - HALL_HALF;
  const ICU_Z0 = 6, ICU_Z1 = 32, icuMid = (ICU_Z0 + ICU_Z1) / 2, icuD = ICU_Z1 - ICU_Z0;
  addFloor(icuCx, icuMid, icuW, icuD); addCeiling(icuCx, icuMid, icuW, icuD);
  addWall(ROOM_X, icuMid, WALL_T, icuD);
  addWall(icuCx, ICU_Z0, icuW, WALL_T);
  addWall(icuCx, ICU_Z1, icuW, WALL_T);
  // 14번은 **영안실** 명패다 — 중환자실에 붙어 있었다. 4번이 격리 A 다
  addSign(4, HALL_HALF - 0.11, 1.66, 20.6, -Math.PI / 2, 0.45, 0.18);

  // ── 망가진 안내 ── 봉쇄된 층이라 안내가 제일 먼저 망가진다
  addSign(11, -0.4, 2.44, 14.5, Math.PI, 1.5, 0.42, false, -0.55);   // 한쪽 줄이 끊겨 매달림
  addSign(13, HALL_HALF - 0.1, 1.48, 9.0, -Math.PI / 2, 0.5, 0.62, false, -0.12);  // 뜯긴 공고문
  addSign(13, 1.6, 0.03, 10.2, -0.5, 0.4, 0.48, false, 0, -Math.PI / 2);           // 바닥 조각

  // 침상 6개가 커튼으로 나뉘어 늘어서 있다 — 커튼 때문에 안쪽이 한 번에 안 보인다
  for (let i = 0; i < 6; i++) {
    const bz = ICU_Z0 + 3.0 + i * 4.2;
    addProp3D('bed', ROOM_X - 1.3, bz, -Math.PI / 2, {
      args: [i % 2], collide: [2.05, 0.95],
    });
    addPropGLB('prop_ivdrip', ROOM_X - 2.5, bz - 1.1, rnd() * 6.28);
    // 커튼은 침상 **앞쪽**에 둔다. 뒤(bz+2.1)에 두면 마지막 침상 것이 z=32.1 이 되어
    // 중환자실 뒤 벽(z=32) 안에 박힌다.
    addProp3D('curtain', ROOM_X - 2.9, bz - 2.1, 0, { args: [1.9, 1.95] });
    if (i % 3 === 0) addSearchable(ROOM_X - 2.2, bz + 0.6, '침상 옆 서랍');
    if (i === 2) addPropGLB('prop_bodybag', icuCx - 1.2, bz, 0.4);
    if (i === 4) addProp3D('wheelchair', icuCx - 1.4, bz - 1.2, rnd() * 6.28, { collide: [0.8, 1.0] });

    // ── 침상마다 다른 흔적 ──
    // 중환자실은 **누워 있던 사람들이 그대로 당한 곳**이다. 침상만 늘어놓으면
    // 가구 전시장이고, 흔적이 있어야 여기서 무슨 일이 있었는지가 읽힌다.
    if (i % 2 === 0) {
      addBlood(ROOM_X - 2.0, bz + 0.4, 2.0 + rnd() * 0.8, 'pool');
      addWallBlood(ROOM_X - 0.06, 1.1 + rnd() * 0.5, bz - 0.6, -Math.PI / 2,
        1.0 + rnd() * 0.6, rnd() < 0.5 ? 'handprint' : 'splatter');
    } else {
      addBlood(ROOM_X - 3.2, bz - 0.8, 2.4, 'drag');   // 침상에서 통로 쪽으로 끌린 자국
    }
    if (i === 1) addProp3D('ivStandFallen', ROOM_X - 3.4, bz + 1.0, rnd() * 6.28, { collide: [1.2, 0.4] });
    if (i === 3) addProp3D('gurneyToppled', icuCx + 0.6, bz + 0.8, rnd() * 6.28, { collide: [1.8, 0.9] });
    if (i === 5) {
      addProp3D('ceilingTileFallen', icuCx + 0.4, bz - 0.8, rnd() * 6.28);
      addProp3D('ceilingHole', icuCx + 0.4, bz - 0.8, 0, { y: 2.84 });
    }
  }
  addPropGLB('prop_panel', ROOM_X - 0.35, ICU_Z0 + 1.6, -Math.PI / 2, { collide: [0.5, 0.3] });
  addPropGLB('prop_computer_cart', icuCx - 1.0, icuMid, 0.2, { collide: [0.6, 0.8] });
  addPropGLB('prop_water_cooler', icuCx - 1.6, ICU_Z1 - 1.8, 0, { collide: [0.4, 0.4] });
  addBlood(icuCx, icuMid - 4, 3.0, 'pool');
  addBlood(icuCx + 1.0, icuMid + 6, 2.4, 'splatter');
  scatterDebris(icuCx, icuMid, icuW - 1.4, icuD - 2, SCATTER.wardDebris);
  addLight(icuCx, 2.85, 11, 'flicker', 0x3d5560);
  addLight(icuCx, 2.85, 27, 'pulse', 0x3d5560);
  addSpawn(icuCx, 10); addSpawn(icuCx, 19); addSpawn(icuCx, 28);

  // ───────── 사건: 수술부 봉쇄 해제 ─────────
  // 옥상으로 가는 문이 안쪽에서 봉쇄돼 있다. 수술실 두 곳의 무영등에 전원을 넣어야 풀린다.
  // 무영등을 켜면 수술실이 환해지는데, 그 순간 방 안이 다 보여서 오히려 더 나쁘다.
  const S = EVENTS.surgery;
  let lamps = 0;
  const onLamp = () => {
    lamps++;
    setMood({ ambientIntensity: 0.045 + lamps * 0.03 });
    if (lamps < S.lampCount) {
      triggerWave(S.waveOnLamp);
      bus.emit(EV.OBJECTIVE, { text: `무영등 ${lamps}/${S.lampCount} — 나머지 수술실로` });
      return `무영등 ${lamps}/${S.lampCount} — 방이 환해졌다`;
    }
    setLights('steady', 1.4);
    triggerWave(S.waveOnComplete);
    bus.emit(EV.OBJECTIVE, { text: '봉쇄가 풀렸다 — 옥상으로' });
    bus.emit(EV.HINT, { text: '봉쇄 해제 — 옥상으로', duration: 5 });
    return '봉쇄가 풀렸다';
  };
  OR_Z.forEach((cz, i) => {
    addLever(-ROOM_X + 0.45, cz + 1.4, Math.PI / 2, `무영등 전원 ${i + 1}`, onLamp);
  });
  addDoor(0, HALL_Z1, HALL_HALF * 2, WALL_T, () => lamps >= S.lampCount,
    '봉쇄문', '수술실 두 곳의 전원을 넣어야 한다');

  // ───────── 옥상 계단실 ─────────
  addFloor(0, EXIT_Z, 9, 8); addCeiling(0, EXIT_Z, 9, 8);
  addWall(-4.5, EXIT_Z, WALL_T, 8);
  addWall(4.5, EXIT_Z, WALL_T, 8);
  addWall(0, EXIT_Z + 4, 9, WALL_T);
  addWall(-(HALL_HALF + gap / 2), HALL_Z1, gap, WALL_T);
  addWall(HALL_HALF + gap / 2, HALL_Z1, gap, WALL_T);
  addProp3D('stairs', 0, EXIT_Z + 3.5, Math.PI, { args: [6.0, 6], collide: [6.0, 1.1] });
  addLight(0, 2.85, EXIT_Z, 'steady', 0x2e7a4a);
  addSign(12, 0, 2.35, EXIT_Z + 3.85, Math.PI, 0.9, 0.36, true);
  scatterDebris(0, EXIT_Z, 7, 7, 0.3);
  addSpawn(-3, EXIT_Z); addSpawn(3, EXIT_Z);

  return {
    playerStart: { x: 0, z: ENTRY_Z - 1.2, yaw: Math.PI },
    exit: { x: 0, z: EXIT_Z + 2.2, radius: 2.2 },
  };
}
