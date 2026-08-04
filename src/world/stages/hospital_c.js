/**
 * 구역 C — 2F 병동 (SPEC.md §3)
 *
 * B1 의 공포가 "완전한 어둠"이었다면, 여기는 **점멸**이다.
 * 불이 깜빡이는 동안 복도 끝에 무언가 서 있었는지 확신할 수 없게 만든다.
 *
 * 구조: 진입 계단실 → 긴 병동 복도 → 좌우 병실 4개씩 → 간호사 스테이션 → 탈출 계단실
 * 병실은 커튼으로 시야가 잘려 있어, 들어가 보기 전에는 안이 안 보인다.
 */

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
  // B1 보다는 밝지만 여전히 어둡다. 점멸이 주인공이라 기본 조도를 낮게 둔다.
  mood: { fogDensity: 0.055, fogColor: 0x060709, ambientIntensity: 0.035 },
  typeWeights: { shambler: 4, listener: 2 },
};

/** 병동은 전부 타일. 간호사 스테이션 앞은 물이 샜다 */
export function surfaceAt(x, z) {
  if (Math.abs(x) < HALL_HALF && z > 23 && z < 27) return 'wet';
  return 'tile';
}

export function build(ctx) {
  const { addWall, addFloor, addCeiling, addLight, addSpawn, addBlood, addWallBlood,
          scatterDebris, addProp3D, addPropGLB, addSign, addSearchable } = ctx;

  let _s = 40517;
  const rnd = () => ((_s = (_s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const trim = (cx, cz, len, horizontal) => {
    addProp3D('baseboard', cx, cz, 0, { args: [len, horizontal] });
    addProp3D('handrail', cx, cz, 0, { args: [len, horizontal] });
  };

  // ───────── 진입 계단실 (B1 에서 올라온다) ─────────
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

  // ───────── 병동 복도 ─────────
  const hallLen = HALL_Z1 - HALL_Z0;
  const hallMid = (HALL_Z0 + HALL_Z1) / 2;
  addFloor(0, hallMid, HALL_HALF * 2, hallLen);
  addCeiling(0, hallMid, HALL_HALF * 2, hallLen);

  // 복도 벽 — 병실마다 문 구멍 하나
  for (const sx of [-1, 1]) {
    let z = HALL_Z0;
    for (const dz of WARD_Z) {
      const seg = dz - 0.85 - z;
      if (seg > 0.1) addWall(sx * HALL_HALF, z + seg / 2, WALL_T, seg);
      addProp3D('doorFrame', sx * HALL_HALF, dz, Math.PI / 2, { args: [1.7, 2.1, 0.3] });
      z = dz + 0.85;
    }
    const last = HALL_Z1 - z;
    if (last > 0.1) addWall(sx * HALL_HALF, z + last / 2, WALL_T, last);
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
    addSign(14, side * (HALL_HALF - 0.11), 1.62, cz - 1.3, side * Math.PI / 2, 0.4, 0.16);

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

    addBlood(cx, cz + rnd() * 3 - 1.5, 2.2 + rnd(), rnd() < 0.5 ? 'splatter' : 'pool');
    scatterDebris(cx, cz, w - 1.4, WARD_D - 1.4, 0.22);
    addLight(cx, 2.85, cz, rnd() < 0.5 ? 'flicker' : 'pulse', 0x37505c);
    addSpawn(cx, cz);
  };

  let wi = 0;
  for (const cz of WARD_Z) { ward(-1, cz, wi++); ward(1, cz, wi++); }

  // ───────── 간호사 스테이션 (복도 중간, z 24 부근) ─────────
  // 복도를 반쯤 막아 시야를 끊는다. 여기서 한 번 놀라게 만드는 자리.
  addPropGLB('prop_reception_desk', -0.9, 24.5, 0.15, { collide: [3.0, 1.0] });
  addPropGLB('prop_computer_cart', 1.4, 25.6, -0.5, { collide: [0.6, 0.8] });
  addSearchable(-0.9, 23.4, '간호사 스테이션');
  addPropGLB('prop_firstaid', 1.2, 23.6, 0.4, { y: 0.0 });
  addSign(15, -HALL_HALF + 0.11, 1.9, 24.5, Math.PI / 2, 0.5, 0.2);

  // ───────── 탈출 계단실 (3F 로) ─────────
  addFloor(0, EXIT_Z, 9, 8); addCeiling(0, EXIT_Z, 9, 8);
  addWall(-4.5, EXIT_Z, WALL_T, 8);
  addWall(4.5, EXIT_Z, WALL_T, 8);
  addWall(0, EXIT_Z + 4, 9, WALL_T);
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
