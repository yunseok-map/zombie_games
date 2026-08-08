/**
 * 구역 C — 2F 병동 (SPEC.md §3)
 *
 * B1 의 공포가 "완전한 어둠"이었다면, 여기는 **점멸**이다.
 * 불이 깜빡이는 동안 복도 끝에 무언가 서 있었는지 확신할 수 없게 만든다.
 *
 * 구조: 진입 계단실 → 긴 병동 복도 → 좌우 병실 4개씩 → 간호사 스테이션 → 탈출 계단실
 * 병실은 커튼으로 시야가 잘려 있어, 들어가 보기 전에는 안이 안 보인다.
 */

import { EVENTS, SCATTER } from '../../config/balance.js';
import { bus, EV } from '../../core/EventBus.js';

const WALL_T = 0.2;
const HALL_HALF = 2.8;
const HALL_Z0 = 4, HALL_Z1 = 44;
const ROOM_X = 11;                 // 병실 바깥 벽
const ENTRY_Z = 0, EXIT_Z = 48;
const WARD_D = 9;                  // 병실 하나의 깊이(z)
const WARD_Z = [10, 20, 30, 40];   // 병실 중심 z — 좌우 대칭

export const meta = {
  id: 'hospital_c',
  label: '2F 병동',
  objective: '병실의 무전기 4대를 켜라',
  // B1 보다는 밝지만 여전히 어둡다. 점멸이 주인공이라 기본 조도를 낮게 둔다.
  mood: { fogDensity: 0.055, fogColor: 0x060709, ambientIntensity: 0.035 },
  typeWeights: { shambler: 4, listener: 2, crawler: 2 },
};

/** 병동은 전부 타일. 간호사 스테이션 앞은 물이 샜다 */
export function surfaceAt(x, z) {
  if (Math.abs(x) < HALL_HALF && z > 23 && z < 27) return 'wet';
  return 'tile';
}

export function build(ctx) {
  const { addWall, addFloor, addCeiling, addLight, addSpawn, addBlood, addWallBlood,
          scatterDebris, addProp3D, addPropGLB, addSign, addSearchable, addWeapon,
          addLever, addDoor, triggerWave, setLights,
          room, wallWithDoors } = ctx;

  let _s = 40517;
  const rnd = () => ((_s = (_s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const trim = (cx, cz, len, horizontal) => {
    addProp3D('baseboard', cx, cz, 0, { args: [len, horizontal] });
    addProp3D('handrail', cx, cz, 0, { args: [len, horizontal] });
  };

  // ───────── 진입 계단실 (B1 에서 올라온다) ─────────
  room(0, ENTRY_Z, 9, 8, { open: 's', t: WALL_T });      // 남쪽이 복도로 트여 있다
  addProp3D('stairs', 0, ENTRY_Z - 3.4, 0, { args: [6.0, 6], collide: [6.0, 1.1] });
  addLight(0, 2.85, ENTRY_Z, 'steady', 0x2e7a4a);
  addSign(12, 0, 2.35, ENTRY_Z - 3.9, 0, 0.9, 0.36, true);
  const gap = (9 - HALL_HALF * 2) / 2;
  addWall(-(HALL_HALF + gap / 2), 4, gap, WALL_T);
  addWall(HALL_HALF + gap / 2, 4, gap, WALL_T);
  addSpawn(-3.2, ENTRY_Z); addSpawn(3.2, ENTRY_Z);

  // ───────── 병동 복도 ─────────
  const hallLen = HALL_Z1 - HALL_Z0;
  const hallMid = (HALL_Z0 + HALL_Z1) / 2;
  addFloor(0, hallMid, HALL_HALF * 2, hallLen);
  addCeiling(0, hallMid, HALL_HALF * 2, hallLen);

  // 복도 벽 — 병실마다 문 구멍 하나
  for (const sx of [-1, 1]) {
    wallWithDoors('z', sx * HALL_HALF, HALL_Z0, HALL_Z1, WARD_Z, { gap: 1.7, t: WALL_T });
    for (const dz of WARD_Z) {
      addProp3D('doorFrame', sx * HALL_HALF, dz, Math.PI / 2, { args: [1.7, 2.1, 0.3] });
      // 문짝 — 틀만 있으면 구멍처럼 보인다. 방마다 다른 각도로 열어 두고
      // 일부는 아예 뜯겨 바닥에 있다. 열린 각도가 다르면 복도가 반복으로 안 느껴진다.
      const kind = (WARD_Z.indexOf(dz) + (sx > 0 ? 2 : 0)) % 4;
      if (kind === 3) {
        addProp3D('doorFallen', sx * (HALL_HALF - 0.8), dz + 0.25,
          Math.PI / 2 + sx * 0.4, { args: [1.62, 2.05] });
      } else {
        const ajar = [1.9, 1.25, 0.65][kind];
        addProp3D('doorPanel', sx * HALL_HALF, dz + 0.85, Math.PI / 2 + sx * ajar,
          { args: [1.65, 2.05] });
      }
    }
    for (const cz of [7, 15, 25, 35, 43]) trim(sx * (HALL_HALF - 0.12), cz, 6, false);
  }

  // 조명 — 이 구역의 정체성. 대부분 깜빡이고, 몇 개는 아예 죽어 있다.
  const deadLights = [15, 27, 39];
  for (const cz of [8, 15, 21, 27, 33, 39, 43]) {
    addProp3D('ceilingLight', 0, cz, 0, { y: 3.1, args: [deadLights.includes(cz)] });
    if (!deadLights.includes(cz)) addLight(0, 2.9, cz, 'flicker', 0x3f4d55);
  }

  // 복도 소품 — 지나가기 좁게 만든다. 좁으면 뒤가 신경 쓰인다.
  addProp3D('bed', -1.4, 13.0, 0.25, { args: [1], collide: [1.0, 2.1] });
  addProp3D('gurneyToppled', 1.3, 31.5, -0.3, { collide: [1.0, 1.6] });
  addPropGLB('prop_mop_bucket', -HALL_HALF + 0.6, 18.5, 0.4, { collide: [0.5, 0.5] });
  addPropGLB('prop_water_cooler', HALL_HALF - 0.45, 9.5, -Math.PI / 2, { collide: [0.4, 0.4] });
  addProp3D('extinguisher', HALL_HALF - 0.22, 36, -Math.PI / 2, { collide: [0.3, 0.3] });
  addPropGLB('prop_corpse', 0.8, 22.0, 1.1);
  addBlood(0.9, 22.4, 3.0, 'pool');
  addBlood(-0.5, 26.0, 2.4, 'drag');
  addWallBlood(-HALL_HALF + 0.12, 1.35, 29.0, Math.PI / 2, 1.7, 'handprint');
  addWallBlood(HALL_HALF - 0.12, 1.35, 17.0, -Math.PI / 2, 1.7, 'handprint');
  for (const [cx, cz] of [[0.7, 12], [-0.8, 34]]) {
    addProp3D('ceilingHole', cx, cz, 0, { y: 3.1 });
    addProp3D('ceilingTileFallen', cx + 0.3, cz + 0.6, rnd() * 6.28);
  }
  scatterDebris(0, hallMid, HALL_HALF * 2 - 0.4, hallLen, 0.26);

  // ───────── 병실 8개 ─────────
  const wardCx = (side) => side * (HALL_HALF + (ROOM_X - HALL_HALF) / 2);

  const ward = (side, cz, idx) => {
    const cx = wardCx(side);
    const w = ROOM_X - HALL_HALF;
    addFloor(cx, cz, w, WARD_D); addCeiling(cx, cz, w, WARD_D);
    addWall(side * ROOM_X, cz, WALL_T, WARD_D);                 // 바깥 벽
    addWall(cx, cz - WARD_D / 2, w, WALL_T);                    // 앞 칸막이
    addWall(cx, cz + WARD_D / 2, w, WALL_T);                    // 뒤 칸막이
    // 명패는 방마다 달라야 한다. 14번은 **영안실(MORTUARY)** 명패라, 병실 문마다
    // "영안실"이 붙어 있었다. 0~2 가 일반병실(301·302·303) 이다.
    // 한 칸은 일부러 비뚤게 매단다 — 다 반듯하면 사람이 관리하는 건물처럼 보인다.
    const plateRoll = idx % 3 === 2 ? (rnd() - 0.5) * 0.55 : 0;
    addSign(idx % 3, side * (HALL_HALF - 0.11), 1.62 - Math.abs(plateRoll) * 0.06,
      cz - 1.3, side * Math.PI / 2, 0.4, 0.16, false, plateRoll);

    // 침대 2개 — 머리를 바깥 벽에 붙인다. 회전이 ±90° 라 충돌 박스는 가로로 길다.
    const bedX = side * (ROOM_X - 1.3);
    for (let i = 0; i < 2; i++) {
      const bz = cz - 2.2 + i * 4.4;
      addProp3D('bed', bedX, bz, side * Math.PI / 2, {
        args: [(idx + i) % 2], collide: [2.05, 0.95],
      });
      // 링거대는 침대 머리맡에
      addPropGLB('prop_ivdrip', bedX - side * 1.1, bz - 1.0, rnd() * 6.28);
      // 커튼으로 침대 사이를 가른다 — 안이 안 보여야 들어가 볼 마음이 든다
      if (i === 0) addProp3D('curtain', side * (ROOM_X - 2.6), bz + 2.2, 0, { args: [1.9, 1.95] });
    }
    addProp3D('cabinet', side * (ROOM_X - 0.6), cz + 3.4, side * Math.PI / 2,
      { collide: [0.7, 0.85] });
    addSearchable(side * (ROOM_X - 1.4), cz + 3.4, '병실 수납장');

    // 방마다 하나씩 다른 것을 둔다 — 다 같으면 탐색할 이유가 없다
    if (idx % 4 === 0) addPropGLB('prop_computer_cart', cx - side * 1.2, cz, 0.3, { collide: [0.6, 0.8] });
    if (idx % 4 === 1) addPropGLB('prop_ventilator', cx - side * 1.4, cz + 0.6, -0.4, { collide: [0.65, 0.65] });
    if (idx % 4 === 2) addPropGLB('prop_bodybag', cx, cz - 1.0, rnd() * 6.28);
    if (idx % 4 === 3) addProp3D('wheelchair', cx - side * 0.9, cz - 2.0, rnd() * 6.28, { collide: [0.8, 1.0] });

    // ───────── 이 방에서 무슨 일이 있었는가 ─────────
    // 방마다 다른 사고를 둔다. 같은 얼룩이 여덟 번 반복되면 배경이 되어 아무도 안 본다.
    // 병실은 **사람이 살던 방**이라, 비어 있으면 즉시 세트장처럼 보인다.
    const inner = side * (ROOM_X - 2.0);        // 침대와 복도 사이의 빈 바닥
    switch (idx % 4) {
      case 0:  // 침대에서 끌려 나갔다
        addBlood(bedX - side * 0.6, cz - 2.0, 2.4, 'pool');
        addBlood(inner, cz - 0.4, 3.0, 'drag');
        addWallBlood(side * (ROOM_X - 0.06), 1.15, cz - 2.4, -side * Math.PI / 2, 1.1, 'handprint');
        addProp3D('ivStandFallen', inner + side * 0.4, cz - 1.4, rnd() * 6.28, { collide: [1.2, 0.4] });
        break;
      case 1:  // 이동침대가 뒤집힌 채 문을 막고 있다
        addBlood(cx, cz + 1.2, 2.6, 'splatter');
        addBlood(inner, cz + 3.0, 2.2, 'drag');
        addProp3D('gurneyToppled', cx - side * 0.5, cz + 2.4, rnd() * 6.28, { collide: [1.8, 0.9] });
        break;
      case 2:  // 천장이 내려앉았다
        // 스폰 지점이 방 중앙(cx, cz)이다 — 잔해를 거기 두면 좀비가 갇힌다.
        // QA 가 "스폰 충돌없음"으로 잡아 준 자리다. 벽 쪽으로 붙여 둔다.
        addProp3D('ceilingHole', cx - side * 1.1, cz - 2.2, 0, { y: 2.84 });
        addProp3D('ceilingTileFallen', cx - side * 0.7, cz - 2.4, rnd() * 6.28);
        addProp3D('rubblePile', cx - side * 1.1, cz - 2.2, rnd() * 6.28, { collide: [1.2, 0.8] });
        addBlood(cx - side * 1.0, cz - 2.0, 2.0, 'splatter');
        break;
      default: // 벽까지 튀었다
        addBlood(bedX - side * 0.9, cz + 2.0, 2.8, 'pool');
        addWallBlood(side * (ROOM_X - 0.06), 1.55, cz + 1.6, -side * Math.PI / 2, 1.6, 'splatter');
        addProp3D('wheelchair', inner, cz + 1.4, rnd() * 6.28,
          { roll: 1.45, y: 0.28, forceProc: true });   // 옆으로 넘어진 휠체어
        break;
    }
    // 방마다 하나는 무조건 더 — 위 사고와 겹쳐서 자국이 층을 이룬다
    for (let b = SCATTER.wardBloodMin; b < SCATTER.wardBloodMax; b++) {
      if (rnd() > 0.55) continue;
      addBlood(cx + (rnd() - 0.5) * (w - 2.2), cz + (rnd() - 0.5) * (WARD_D - 2.4),
        1.4 + rnd() * 1.2, rnd() < 0.5 ? 'splatter' : 'drag');
    }
    scatterDebris(cx, cz, w - 1.4, WARD_D - 1.4, SCATTER.wardDebris);
    addLight(cx, 2.85, cz, rnd() < 0.5 ? 'flicker' : 'pulse', 0x37505c);
    addSpawn(cx, cz);
  };

  let wi = 0;
  for (const cz of WARD_Z) { ward(-1, cz, wi++); ward(1, cz, wi++); }

  // ───────── 간호사 스테이션 (복도 중간, z 24 부근) ─────────
  // 복도를 반쯤 막아 시야를 끊는다. 여기서 한 번 놀라게 만드는 자리.
  addPropGLB('prop_reception_desk', -0.9, 24.5, 0.15, { collide: [3.0, 1.0] });
  // 카트는 **데스크 뒤로** 물렸다. 예전 자리(1.4, 25.6)는 데스크를 비켜 가는 우측
  // 통로 한복판이었다. 데스크가 x -2.40~0.60 을 막고 카트가 1.10~1.70 을 막아,
  // 사람(반지름 0.35)이 설 수 있는 자리가 **x 2.05~2.35 = 30cm** 만 남았다.
  // 지나갈 수는 있지만 벽으로 읽힌다 — 다른 네 층의 가장 좁은 복도가 1.35m 다.
  // 여기서 시야를 끊는 것은 데스크 몫이고, 카트까지 겹칠 이유가 없다.
  addPropGLB('prop_computer_cart', 0.0, 26.3, -0.5, { collide: [0.6, 0.8] });
  addSearchable(-0.9, 23.4, '간호사 스테이션');
  // 간호사 스테이션의 라디오. 던지면 좀비가 그쪽으로 몰린다 —
  // 이 구역까지는 싸우거나 도망치는 것뿐이었다. 여기서 **피해 가는 선택지**가 생긴다.
  addWeapon(1.4, 23.0, 'radio', '라디오');
  addPropGLB('prop_firstaid', 1.2, 23.6, 0.4, { y: 0.0 });
  // 15번은 **기계실 B1** 명패다 — 간호사 스테이션에 붙어 있었다. 5번이 간호사실이다
  addSign(5, -HALL_HALF + 0.11, 1.9, 24.5, Math.PI / 2, 0.5, 0.2);

  // ── 망가진 안내 ──
  // 사람이 관리하던 건물이 관리를 멈춘 지점을 표지판으로 보여 준다.
  // 반듯한 표지판만 있으면 "아직 운영 중인 병원"으로 읽힌다.
  //   · 천장 방향표지가 한쪽 줄이 끊겨 매달려 있다
  addSign(11, 0.35, 2.42, 16.0, Math.PI, 1.5, 0.42, false, 0.62);
  //   · 비상구 등이 죽었다 — glow 를 끄면 같은 판이 꺼진 등이 된다
  addSign(12, 0, 2.35, 34.0, Math.PI, 0.9, 0.36, false, -0.14);
  //   · 뜯긴 공고문. 벽에 남은 것과 바닥에 떨어진 조각
  addSign(13, -HALL_HALF + 0.1, 1.5, 30.5, Math.PI / 2, 0.5, 0.62, false, 0.1);
  // 떨어진 조각은 눕혀야 한다(pitch). roll 만 주면 바닥에 반쯤 박힌 판이 된다
  addSign(13, -2.2, 0.03, 31.4, 0.7, 0.42, 0.5, false, 0, -Math.PI / 2);

  // ───────── 사건: 병실 무전기 4대 ─────────
  // B1 의 레버가 "어둠을 걷어내는" 일이었다면, 여기는 반대다 — 켤수록 위치가 들킨다.
  // 무전기는 병실 안쪽에 있어서, 켜려면 커튼 뒤가 안 보이는 방으로 들어가야 한다.
  const W = EVENTS.ward;
  let radios = 0;
  const onRadio = () => {
    radios++;
    if (radios < W.radioCount) {
      triggerWave(W.waveOnRadio);          // 소리가 났다. 대가는 즉시 치른다
      // 몇 개 남았는지는 계속 보여야 한다. 힌트로만 띄우면 놓친 순간 헤맨다
      bus.emit(EV.OBJECTIVE, { text: `무전기 ${radios}/${W.radioCount} 켜짐 — 남은 병실을 찾아라` });
      return `무전 ${radios}/${W.radioCount} — 응답 없음. 소리가 났다`;
    }
    setLights('pulse', 1.3);
    triggerWave(W.waveOnComplete);
    bus.emit(EV.OBJECTIVE, { text: '계단실이 열렸다 — 위층으로' });
    bus.emit(EV.HINT, { text: '계단실 잠금 해제 — 위층으로', duration: 5 });
    return '마지막 무전 — 계단실이 열렸다';
  };
  // 병실 4곳(좌우 번갈아). 안쪽 벽에 붙여 둔다.
  [[-1, WARD_Z[0]], [1, WARD_Z[1]], [-1, WARD_Z[2]], [1, WARD_Z[3]]]
    .forEach(([side, cz], i) => {
      addLever(side * (ROOM_X - 0.5), cz - 1.2, side * Math.PI / 2, `무전기 ${i + 1}`, onRadio);
    });
  // 무전 4대를 다 켜야 열리는 문. 카드키가 아니라 진행도로 열린다.
  addDoor(0, HALL_Z1, HALL_HALF * 2, WALL_T, () => radios >= W.radioCount,
    '계단실 문', '무전을 전부 켜야 한다');

  // ───────── 탈출 계단실 (3F 로) ─────────
  room(0, EXIT_Z, 9, 8, { open: 'n', t: WALL_T });       // 북쪽이 복도로 트여 있다
  addWall(-(HALL_HALF + gap / 2), HALL_Z1, gap, WALL_T);
  addWall(HALL_HALF + gap / 2, HALL_Z1, gap, WALL_T);
  addProp3D('stairs', 0, EXIT_Z + 3.5, Math.PI, { args: [6.0, 6], collide: [6.0, 1.1] });
  addLight(0, 2.85, EXIT_Z, 'steady', 0x2e7a4a);
  addSign(12, 0, 2.35, EXIT_Z + 3.85, Math.PI, 0.9, 0.36, true);
  addBlood(0, EXIT_Z - 1.6, 2.8, 'pool');
  scatterDebris(0, EXIT_Z, 7, 7, 0.34);
  addSpawn(-3, EXIT_Z); addSpawn(3, EXIT_Z);

  return {
    playerStart: { x: 0, z: ENTRY_Z - 1.2, yaw: Math.PI },
    exit: { x: 0, z: EXIT_Z + 2.2, radius: 2.2 },
  };
}
