import * as THREE from 'three';

/**
 * 구역 A — 1F 로비 · 응급실 (SPEC.md §3)
 *
 * 회색 박스 레벨이다. 텍스처는 나중에 입힌다. (ASSETS.md §2 작업 순서)
 * 구조: 로비(넓음) → 중앙 복도(좁고 긺) → 양옆 병실 12개 → 계단실
 *   병실 모듈을 반복해서 만든다. 이게 폐병원을 고른 가장 큰 이유다.
 */

const WALL_H = 3.1;
const WALL_T = 0.2;
const ROOM_DEPTH = 6;    // 복도 옆 병실 깊이 (x 방향)
const ROOM_PITCH = 7;    // 병실 간격 (z 방향)
const ROOM_COUNT = 6;    // 한쪽당
const CORR_HALF = 2;     // 복도 반폭
const DOOR_W = 1.3;
const CORR_LEN = ROOM_PITCH * ROOM_COUNT;   // 42
const OUTER_X = CORR_HALF + ROOM_DEPTH;     // 8

export const meta = {
  id: 'hospital_a',
  label: '1F 로비 · 응급실',
  mood: { fogDensity: 0.052, fogColor: 0x05070a, ambientIntensity: 0.06 },
  typeWeights: { shambler: 1 },
};

/**
 * 바닥 재질 — 발소리가 이걸 본다 (Player._footsteps).
 * 복도·로비는 콘크리트, 병실은 타일, 천장이 무너진 자리는 잔해,
 * 큰 핏자국 위는 젖은 소리.
 */
const DEBRIS_SPOTS = [[0.5, 8.5], [-0.6, 19.0], [0.4, 31.5]];   // 천장 붕괴 지점
const WET_SPOTS = [[0.4, 6.0], [0.8, -14.2], [0, CORR_LEN + 2.6]];

export function surfaceAt(x, z) {
  for (const [sx, sz] of DEBRIS_SPOTS) {
    if (Math.abs(x - sx) < 1.3 && Math.abs(z - sz) < 1.3) return 'debris';
  }
  for (const [sx, sz] of WET_SPOTS) {
    if (Math.abs(x - sx) < 1.2 && Math.abs(z - sz) < 1.2) return 'wet';
  }
  // 병실은 타일 바닥, 복도·로비는 콘크리트
  return Math.abs(x) > CORR_HALF && z > 0 ? 'tile' : 'concrete';
}

export function build(ctx) {
  const { addWall, addFloor, addCeiling, addProp, addLight, addSpawn,
          addBlood, addWallBlood, scatterDebris, addItem, addDoor,
          addProp3D, addSign, addSearchable } = ctx;

  // 결정적 난수 — 매 판 같은 배치여야 레벨이 흔들리지 않는다
  let _s = 4021;
  const rnd = () => ((_s = (_s * 1664525 + 1013904223) >>> 0) / 4294967296);

  /** 벽면을 따라 걸레받이 + 핸드레일 (Phase 2) */
  const trim = (cx, cz, len, horizontal, rail = true) => {
    addProp3D('baseboard', cx, cz, 0, { args: [len, horizontal] });
    if (rail) addProp3D('handrail', cx, cz, 0, { args: [len, horizontal] });
  };

  // ───────── 로비 (z: -16 ~ 0) ─────────
  addFloor(0, -8, OUTER_X * 2, 16);
  addCeiling(0, -8, OUTER_X * 2, 16);
  addWall(-OUTER_X, -8, WALL_T, 16);            // 좌
  addWall(OUTER_X, -8, WALL_T, 16);             // 우
  addWall(0, -16, OUTER_X * 2, WALL_T);         // 뒤 (봉쇄된 정문)

  // 로비 → 복도 격벽 (가운데만 뚫림)
  const sideW = OUTER_X - CORR_HALF;
  addWall(-(CORR_HALF + sideW / 2), 0, sideW, WALL_T);
  addWall(CORR_HALF + sideW / 2, 0, sideW, WALL_T);

  // 로비 소품 — 접수 데스크, 대기 의자, 바리케이드
  addProp3D('receptionDesk', -4.5, -12, 0, { args: [3.4, 1.1], collide: [3.6, 1.15] });
  addProp3D('chairRow', 4.2, -13, 0, { args: [4], collide: [0.7, 2.5] });
  addProp3D('chairRow', 4.2, -8.5, 0, { args: [4], collide: [0.7, 2.5] });
  addProp3D('barricade', 0, -15.2, 0, { args: [4.0, 1.7], collide: [4.2, 0.6] });
  addProp3D('vendingMachine', -6.9, -3.2, Math.PI / 2, { collide: [0.75, 0.95] });
  addLight(0, 2.85, -11, 'flicker');
  addLight(-5, 2.85, -4, 'pulse', 0x2e6a5a);
  addSpawn(-6.5, -14); addSpawn(6.5, -14); addSpawn(6.8, -4);

  // 로비의 흔적 — 정문 바리케이드 앞에서 뭔가 벌어졌다
  addBlood(0.8, -14.2, 2.4, 'pool');
  addBlood(-3.2, -12.6, 1.7);
  addWallBlood(0, 1.5, -15.85, 0, 2.6);              // 봉쇄된 정문 벽
  addBlood(5.0, -9.0, 1.5, 'splatter');
  scatterDebris(0, -8, OUTER_X * 2 - 1.5, 15, 0.30);

  // ── 로비 디테일 ──
  trim(-OUTER_X + 0.12, -8, 16, false);                  // 좌우 벽 걸레받이+레일
  trim(OUTER_X - 0.12, -8, 16, false);
  trim(0, -16 + 0.12, OUTER_X * 2, true, false);         // 봉쇄된 정문 쪽은 레일 없음
  addProp3D('cornerGuard', -OUTER_X + 0.12, -0.3, 0, { args: [2.2] });
  addProp3D('cornerGuard', OUTER_X - 0.12, -0.3, 0, { args: [2.2] });

  addProp3D('extinguisher', OUTER_X - 0.22, -6.0, -Math.PI / 2, { collide: [0.3, 0.3] });
  addProp3D('extinguisher', -OUTER_X + 0.22, -13.5, Math.PI / 2, { collide: [0.3, 0.3] });
  addProp3D('cart', -2.4, -13.2, 0.4, { collide: [0.7, 0.5] });
  addSearchable(-2.4, -12.7, '처치 카트');
  addSearchable(-4.5, -11.3, '접수 데스크');
  addProp3D('wheelchair', 5.6, -11.4, 2.1, { collide: [0.6, 0.6] });
  addProp3D('ivStand', -6.4, -9.2, 0);
  addProp3D('vent', -OUTER_X + 0.13, -5.0, Math.PI / 2, { args: [0.5, 0.3], y: 2.55 });

  // 게시물 (Phase 4) — 전부 가상 기관명 (CLAUDE.md §2)
  addSign(10, -OUTER_X + 0.12, 1.6, -10.5, Math.PI / 2, 0.82, 1.0);   // 층 안내도
  addSign(8, OUTER_X - 0.12, 1.62, -12.4, -Math.PI / 2, 0.62, 0.86);  // 검역 경고
  addSign(9, OUTER_X - 0.12, 1.62, -10.4, -Math.PI / 2, 0.62, 0.86);  // 감염 예방 수칙
  addSign(13, 0, 1.72, -15.85, 0, 0.6, 0.78);                          // 출입 통제 (찢어진)
  addProp3D('ceilingLight', -4, -12, 0, { y: WALL_H, args: [false] });
  addProp3D('ceilingLight', 4, -5, 0, { y: WALL_H, args: [true] });

  // ───────── 중앙 복도 (z: 0 ~ 42) ─────────
  addFloor(0, CORR_LEN / 2, CORR_HALF * 2, CORR_LEN);
  addCeiling(0, CORR_LEN / 2, CORR_HALF * 2, CORR_LEN);

  for (let side = 0; side < 2; side++) {
    const sx = side === 0 ? -1 : 1;                 // -1 = 왼쪽
    const wallX = sx * CORR_HALF;
    const roomCx = sx * (CORR_HALF + ROOM_DEPTH / 2);

    for (let i = 0; i < ROOM_COUNT; i++) {
      const z0 = i * ROOM_PITCH;
      const zc = z0 + ROOM_PITCH / 2;

      // 복도 벽 — 문 구멍을 남기고 위아래로 나눠 세운다
      const segLen = (ROOM_PITCH - DOOR_W) / 2;
      addWall(wallX, z0 + segLen / 2, WALL_T, segLen);
      addWall(wallX, z0 + ROOM_PITCH - segLen / 2, WALL_T, segLen);

      // 병실
      addFloor(roomCx, zc, ROOM_DEPTH, ROOM_PITCH);
      addCeiling(roomCx, zc, ROOM_DEPTH, ROOM_PITCH);
      addWall(sx * OUTER_X, zc, WALL_T, ROOM_PITCH);              // 외벽
      addWall(roomCx, z0, ROOM_DEPTH, WALL_T);                    // 병실 격벽
      if (i === ROOM_COUNT - 1) addWall(roomCx, z0 + ROOM_PITCH, ROOM_DEPTH, WALL_T);

      // ── Phase 1 · 문틀 + 문짝 + 명패 ──
      const doorZ = z0 + ROOM_PITCH / 2;
      const wallYaw = Math.PI / 2;                    // z 방향으로 뻗은 벽
      addProp3D('doorFrame', wallX, doorZ, wallYaw, { args: [DOOR_W, 2.1, 0.3] });
      // 경첩을 문틈 한쪽 끝에 두고, 방마다 다른 각도로 열어둔다
      // 문 상태 — 애니메이션 없이 정지 상태로 다양성을 만든다
      //   torn 경첩이 뜯겨 바닥에 · board 판자로 막힘 · 나머지는 열린 각도만 다름
      // 판자로 막힌 방에는 수납장을 넣지 않는다 — 닿을 수 없는 전리품은 죽은 콘텐츠다
      const roomSearch = (x, z, label) => { if (doorKind !== 'board') addSearchable(x, z, label); };
      const doorKind = (side === 0
        ? ['ajar', 'torn', 'ajar', 'board', 'ajar', 'torn']
        : ['torn', 'ajar', 'board', 'ajar', 'torn', 'ajar'])[i];
      const ajar = [1.55, 0, 1.9, 0, 1.15, 0][i];
      if (doorKind === 'torn') {
        addProp3D('doorFallen', wallX - sx * 0.75, doorZ + 0.2, wallYaw + sx * 0.35,
          { args: [DOOR_W - 0.05, 2.05] });
        // 경첩만 문틀에 남아 있다
        addProp3D('cornerGuard', wallX, doorZ - DOOR_W / 2 + 0.05, 0, { args: [0.16], y: 1.5 });
      } else if (doorKind === 'board') {
        addProp3D('boardedDoor', wallX, doorZ, wallYaw, { args: [DOOR_W] });
        addWall(wallX, doorZ, 0.16, DOOR_W);          // 판자로 막힌 문은 못 지나간다
      } else {
        addProp3D('doorPanel', wallX, doorZ + DOOR_W / 2, wallYaw + sx * ajar,
          { args: [DOOR_W - 0.05, 2.05] });
      }
      // 명패 — 복도 쪽 벽, 문 옆. 한쪽 나사가 빠져 삐뚤게 걸린 것들이 섞인다
      const crooked = [0, 0.22, 0, -0.34, 0.11, 0][i];
      if (i !== 4 || side !== 1) {                    // 한 자리는 명패가 아예 떨어져 나갔다
        addSign((i + side * 6) % 8, wallX - sx * 0.11, 1.62, doorZ - DOOR_W / 2 - 0.42,
          sx > 0 ? -Math.PI / 2 : Math.PI / 2, 0.34, 0.14, false, crooked);
      }
      // 문틀·명패 주변 핏자국 — 손자국처럼 문 옆에 남는다
      if (i % 3 === 0) addWallBlood(wallX - sx * 0.12, 1.25, doorZ + DOOR_W / 2 + 0.32,
        sx > 0 ? -Math.PI / 2 : Math.PI / 2, 1.3, 'handprint');

      // ── Phase 2 · 복도 벽 걸레받이 + 핸드레일 ──
      const segLenT = (ROOM_PITCH - DOOR_W) / 2;
      const railX = wallX - sx * 0.12;
      trim(railX, z0 + segLenT / 2, segLenT, false);
      trim(railX, z0 + ROOM_PITCH - segLenT / 2, segLenT, false);
      addProp3D('cornerGuard', railX, doorZ - DOOR_W / 2 - 0.12, 0, { args: [2.0] });
      addProp3D('cornerGuard', railX, doorZ + DOOR_W / 2 + 0.12, 0, { args: [2.0] });

      // ── Phase 3 · 병실 소품 (4종 프리셋 반복) ──
      const preset = (i + side) % 4;
      const bx = roomCx + sx * 1.4;
      // 침대 흐트러짐 — 0 정돈 / 1 이불 뭉침 / 2 매트리스 어긋남 / 3 매트리스 바닥
      const bv = (i * 3 + side * 2) % 4;
      /** 침대 위 핏자국 — 매트리스 윗면(y≈0.63)에 얹는다 */
      const bedBlood = (x, z, size) => addBlood(x, z, size, null, 0.635);

      if (preset === 0) {
        addProp3D('bed', bx, zc - 1.6, 0, { collide: [0.95, 2.05], args: [bv] });
        addProp3D('bed', bx, zc + 1.6, 0, { collide: [0.95, 2.05], args: [(bv + 2) % 4] });
        addProp3D('ivStand', roomCx - sx * 1.9, zc - 1.2, 0);
        addProp3D('curtain', roomCx + sx * 0.2, zc, Math.PI / 2, { args: [1.9, 1.95] });
        bedBlood(bx, zc - 1.9, 1.0);
      } else if (preset === 1) {
        addProp3D('bed', bx, zc, 0, { collide: [0.95, 2.05], args: [bv] });
        addProp3D('cabinet', roomCx, zc + 2.4, Math.PI, { collide: [0.75, 0.5] });
        roomSearch(roomCx, zc + 2.0, '서랍장');
        // 링거대가 넘어져 있다
        addProp3D('ivStandFallen', bx - sx * 0.9, zc - 1.3, rnd() * 6.28);
        bedBlood(bx, zc + 0.2, 1.25);
        addBlood(bx - sx * 0.85, zc + 1.1, 1.5, 'drag');       // 침대에서 끌려나간 자국
      } else if (preset === 2) {
        addProp3D('examTable', roomCx, zc - 2.0, 0, { args: [3.6, 0.6], collide: [3.6, 0.65] });
        addProp3D('cart', bx, zc + 1.8, rnd() * 6.28, { collide: [0.7, 0.5] });
        roomSearch(bx, zc + 1.4, '처치 카트');
        addProp3D('cabinet', roomCx - sx * 2.2, zc + 1.0, -sx * Math.PI / 2, { collide: [0.5, 0.75] });
        roomSearch(roomCx - sx * 1.8, zc + 1.0, '약품 캐비닛');
        addBlood(roomCx, zc - 1.35, 1.4, 'pool', 0.955);       // 검사대 위
      } else {
        addProp3D('bed', bx, zc - 1.5, 0, { collide: [0.95, 2.05], args: [3] });  // 매트리스 바닥
        // 휠체어가 옆으로 넘어져 있다
        addProp3D('wheelchair', roomCx - sx * 1.8, zc + 1.2, rnd() * 6.28,
          { roll: Math.PI / 2 - 0.15, y: 0.3 });
        addProp3D('cart', roomCx, zc - 2.4, rnd() * 6.28, { collide: [0.7, 0.5] });
        roomSearch(roomCx, zc - 2.0, '처치 카트');
        bedBlood(bx + sx * 0.9, zc - 1.5, 1.3);                // 바닥에 떨어진 매트리스 위
      }
      // 병실 벽 핏자국 — 절반 정도만. 전부 넣으면 무뎌진다
      if ((i + side) % 3 === 0) {
        addWallBlood(sx * (OUTER_X - 0.14), 1.25, zc - 2.2, -sx * Math.PI / 2, 1.7,
          i % 2 ? 'handprint' : 'splatter');
      }
      // 병실 벽 환기구
      if (i % 2 === 1) addProp3D('vent', sx * (OUTER_X - 0.13), zc + 1.6, -sx * Math.PI / 2,
        { args: [0.5, 0.3], y: 2.55 });

      // 병실의 흔적 — 전부 넣으면 무뎌진다. 절반 정도만 사건이 있었던 방으로 둔다
      const inward = sx * (OUTER_X - WALL_T / 2 - 0.03);
      if (preset === 0 || preset === 2) {
        addBlood(bx, zc + (preset === 0 ? -1.6 : 1.8), 1.9);          // 침대·검사대 옆
        addWallBlood(inward, 1.35, zc - 0.6, -sx * Math.PI / 2, 1.9); // 외벽에 분사
      }
      if (preset === 3) addBlood(roomCx, zc + 0.4, 2.2, 'drag');       // 끌려나간 자국
      scatterDebris(roomCx, zc, ROOM_DEPTH - 1.2, ROOM_PITCH - 1.2, 0.55);

      // 판자로 막힌 방에는 스폰하지 않는다. 문이 벽이라 나올 수가 없어서,
      // 거기 나온 좀비는 15초 뒤 자동 반납될 때까지 하드캡(14)만 차지한다 —
      // 화면에는 아무 일도 안 일어나는데 압박만 줄어든다.
      if (doorKind !== 'board') addSpawn(roomCx, zc);
      if (i % 2 === 0) {
        addLight(roomCx, 2.85, zc, i % 4 === 0 ? 'flicker' : 'steady', 0x3a4a52);
        addProp3D('ceilingLight', roomCx, zc, sx * Math.PI / 2, { y: WALL_H, args: [false] });
      } else {
        // 꺼진 방은 기구만 남기고 하나는 깨져 있다 (Phase 5-3)
        addProp3D('ceilingLight', roomCx, zc, sx * Math.PI / 2, { y: WALL_H, args: [i % 3 === 1] });
      }
    }
  }

  // 복도 조명 — 드문드문. 어두운 구간이 있어야 손전등이 의미를 갖는다
  for (let i = 0; i < ROOM_COUNT; i++) {
    const lz = i * ROOM_PITCH + ROOM_PITCH / 2;
    if (i % 2 === 0) {
      addLight(0, 2.9, lz, 'flicker');
      addProp3D('ceilingLight', 0, lz, 0, { y: WALL_H, args: [false] });
    } else {
      addProp3D('ceilingLight', 0, lz, 0, { y: WALL_H, args: [true] });   // 깨진 등
    }
    addProp3D('emergencyLamp', 0, lz - ROOM_PITCH / 2, 0, { y: WALL_H - 0.12 });
  }

  // 복도 방향 표지 — 천장에 매달림 (Phase 4-3)
  addSign(11, 0, 2.55, 4.0, Math.PI, 1.5, 0.42);
  addSign(11, 0, 2.55, 4.0, 0, 1.5, 0.42);
  addSign(11, 0, 2.55, 27.0, Math.PI, 1.5, 0.42);

  // 복도 장애물 — 시야를 끊어 긴장을 만든다
  addProp3D('rubblePile', -0.9, 12.5, 0.3, { args: [1.6, 1.2, 0.7], collide: [1.6, 0.75] });
  addProp3D('rubblePile', 1.15, 26.0, -0.5, { args: [1.3, 1.5, 0.8], collide: [1.3, 0.85] });
  addProp3D('rubblePile', -1.0, 34.5, 0.9, { args: [1.7, 0.9, 0.6], collide: [1.7, 0.65] });   // 한쪽에 붙인다 — 가운데 두면 통과 폭이 0.1m 밖에 안 남는다

  // 무너진 천장 — 타일이 떨어져 바닥에 흩어지고 그 자리엔 배선이 늘어져 있다
  for (const [cz, ox] of [[8.5, 0.5], [19.0, -0.6], [31.5, 0.4]]) {
    addProp3D('ceilingHole', ox, cz, 0, { y: WALL_H - 0.02 });
    addProp3D('ceilingTileFallen', ox + 0.15, cz + 0.4, rnd() * 6.28);
    addProp3D('ceilingTileFallen', ox - 0.5, cz - 0.7, rnd() * 6.28);
  }
  // 넘어진 이동침대 — 복도를 반쯤 막는다 (지나갈 수는 있다)
  addProp3D('gurneyToppled', -1.05, 13.6, 0.18, { collide: [1.0, 1.6] });
  addProp3D('gurneyToppled', 1.0, 27.6, Math.PI - 0.22, { collide: [1.0, 1.6] });
  addWallBlood(-CORR_HALF + 0.12, 1.3, 14.4, Math.PI / 2, 1.5, 'handprint');
  addWallBlood(CORR_HALF - 0.12, 1.3, 28.4, -Math.PI / 2, 1.5, 'handprint');

  // 로비 — 바리케이드 옆 손자국
  addWallBlood(-OUTER_X + 0.13, 1.3, -13.0, Math.PI / 2, 1.6, 'handprint');

  // 복도의 흔적 — 무언가가 계단실 쪽으로 끌려갔다. 플레이어가 가는 방향이다
  for (let i = 0; i < 6; i++) {
    addBlood(-0.5 + Math.sin(i * 1.7) * 0.9, 9 + i * 5.2, 2.6, 'drag');
  }
  addBlood(0.4, 6.0, 2.2, 'pool');
  addBlood(-1.0, 30.5, 1.8, 'splatter');
  addWallBlood(-CORR_HALF + 0.12, 1.45, 21.0, Math.PI / 2, 2.2);
  scatterDebris(0, CORR_LEN / 2, CORR_HALF * 2 - 0.4, CORR_LEN, 0.22);

  // ───────── 목표: 카드키 → 계단실 문 (SPEC.md §3 구역 A) ─────────
  // 카드키는 복도 중간 왼쪽 병실(i=2)의 검사대 위에 있다. 끝까지 걸어가야만 보인다.
  addItem(-5, 15.5, 'cardkey', '카드키', 0.98);
  addDoor(0, CORR_LEN, CORR_HALF * 2, WALL_T, 'cardkey', '계단실 문');

  // ───────── 계단실 (z: 42 ~ 50) ─────────
  const stZ = CORR_LEN + 4;
  addFloor(0, stZ, 8, 8);
  addCeiling(0, stZ, 8, 8);
  addWall(-4, stZ, WALL_T, 8);
  addWall(4, stZ, WALL_T, 8);
  addWall(0, stZ + 4, 8, WALL_T);
  const gap = (8 - CORR_HALF * 2) / 2;
  addWall(-(CORR_HALF + gap / 2), CORR_LEN, gap, WALL_T);
  addWall(CORR_HALF + gap / 2, CORR_LEN, gap, WALL_T);
  addProp3D('stairs', 0, stZ + 3.5, Math.PI, { args: [6.0, 6], collide: [6.0, 1.1] });   // 계단 (탈출구)
  addLight(0, 2.85, stZ, 'steady', 0x2e7a4a);
  addSpawn(-3, stZ); addSpawn(3, stZ);

  // 계단실 — 끌린 자국이 여기서 끝난다
  addBlood(0, stZ - 1.4, 3.0, 'pool');
  scatterDebris(0, stZ, 7, 7, 0.45);

  // ── 계단실 디테일 ── 비상구 표지가 목적지를 알려준다 (Phase 4-4)
  addSign(12, 0, 2.35, stZ + 3.85, Math.PI, 0.9, 0.36, true);          // 발광
  addSign(12, 0, 2.35, CORR_LEN + 0.2, 0, 0.9, 0.36, true);
  trim(-4 + 0.12, stZ, 8, false);
  trim(4 - 0.12, stZ, 8, false);
  addProp3D('extinguisher', -3.7, stZ + 2.6, Math.PI / 2, { collide: [0.3, 0.3] });
  addProp3D('ceilingLight', 0, stZ, 0, { y: WALL_H, args: [false] });
  addProp3D('vent', 0, stZ + 3.85, Math.PI, { args: [0.5, 0.3], y: 2.6 });

  return {
    playerStart: { x: 0, z: -11, yaw: Math.PI },   // 로비에서 복도(+Z) 를 바라본다
    exit: { x: 0, z: stZ + 2, radius: 2.2 },
  };
}

export const WALL_HEIGHT = WALL_H;
