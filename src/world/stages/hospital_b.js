import { GENERATOR } from '../../config/balance.js';
import { bus, EV } from '../../core/EventBus.js';

/**
 * 구역 B — B1 영안실 · 기계실 (SPEC.md §3)
 *
 * 완전 암흑. 이 구역의 공포는 어둠 그 자체다 — 손전등이 유일한 시야.
 * 핵심 이벤트: 전원 레버 3개를 올리면 불이 켜지고, 2초의 안도 뒤 대규모 웨이브.
 *
 * 구조: 진입 계단실 → 중앙 통로 → (좌) 영안실 · (우) 기계실 → 탈출 계단실
 */

const WALL_T = 0.2;
const HALL_HALF = 2.5;          // 중앙 통로 반폭
const HALL_Z0 = 4, HALL_Z1 = 30;
const ROOM_X = 11;              // 좌우 방 바깥 벽
const ENTRY_Z = 0, EXIT_Z = 34;

export const meta = {
  id: 'hospital_b',
  label: 'B1 영안실 · 기계실',
  // 완전 암흑 — 구역 A(0.06)보다 훨씬 어둡고 포그도 짙다
  mood: { fogDensity: 0.075, fogColor: 0x030406, ambientIntensity: 0.022 },
  typeWeights: { shambler: 3, listener: 2, crawler: 1 },
};

/** 바닥 재질 — 기계실은 콘크리트, 영안실은 타일, 통로 중앙은 물이 고여 있다 */
export function surfaceAt(x, z) {
  if (Math.abs(x) < HALL_HALF && z > 12 && z < 17) return 'wet';
  if (x < -HALL_HALF) return 'tile';
  return 'concrete';
}

export function build(ctx) {
  const { addWall, addFloor, addCeiling, addLight, addSpawn, addBlood, addWallBlood,
          scatterDebris, addProp3D, addSign, addSearchable, addLever,
          triggerWave, setMood, setLights } = ctx;

  let _s = 90211;
  const rnd = () => ((_s = (_s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const trim = (cx, cz, len, horizontal) => {
    addProp3D('baseboard', cx, cz, 0, { args: [len, horizontal] });
    addProp3D('handrail', cx, cz, 0, { args: [len, horizontal] });
  };

  // ───────── 진입 계단실 (z: -4 ~ 4) ─────────
  addFloor(0, ENTRY_Z, 9, 8); addCeiling(0, ENTRY_Z, 9, 8);
  addWall(-4.5, ENTRY_Z, WALL_T, 8);
  addWall(4.5, ENTRY_Z, WALL_T, 8);
  addWall(0, ENTRY_Z - 4, 9, WALL_T);
  addProp3D('stairs', 0, ENTRY_Z - 3.4, 0, { args: [6.0, 6], collide: [6.0, 1.1] });
  addLight(0, 2.85, ENTRY_Z, 'flicker', 0x2e7a4a);
  addSign(12, 0, 2.35, ENTRY_Z - 3.9, 0, 0.9, 0.36, true);      // 비상구
  const gap = (9 - HALL_HALF * 2) / 2;
  addWall(-(HALL_HALF + gap / 2), 4, gap, WALL_T);
  addWall(HALL_HALF + gap / 2, 4, gap, WALL_T);
  addSpawn(-3.4, ENTRY_Z); addSpawn(3.4, ENTRY_Z);

  // ───────── 중앙 통로 (z: 4 ~ 30) ─────────
  const hallLen = HALL_Z1 - HALL_Z0;
  addFloor(0, (HALL_Z0 + HALL_Z1) / 2, HALL_HALF * 2, hallLen);
  addCeiling(0, (HALL_Z0 + HALL_Z1) / 2, HALL_HALF * 2, hallLen);

  // 통로 벽 — 방으로 들어가는 문 구멍 2개씩 남긴다
  const doors = [10, 22];
  for (const sx of [-1, 1]) {
    let z = HALL_Z0;
    for (const dz of doors) {
      const segA = dz - 0.8 - z;
      if (segA > 0.1) addWall(sx * HALL_HALF, z + segA / 2, WALL_T, segA);
      addProp3D('doorFrame', sx * HALL_HALF, dz, Math.PI / 2, { args: [1.6, 2.1, 0.3] });
      addProp3D('doorFallen', sx * HALL_HALF - sx * 0.8, dz + 0.3, Math.PI / 2 + sx * 0.4,
        { args: [1.5, 2.05] });                       // B1 의 문은 전부 뜯겨 있다
      z = dz + 0.8;
    }
    const last = HALL_Z1 - z;
    if (last > 0.1) addWall(sx * HALL_HALF, z + last / 2, WALL_T, last);
    trim(sx * (HALL_HALF - 0.12), 8, 7, false);
    trim(sx * (HALL_HALF - 0.12), 26, 7, false);
  }

  // 천장 붕괴 · 잔해 · 물웅덩이
  for (const [cx, cz] of [[0.6, 9], [-0.7, 20], [0.4, 27]]) {
    addProp3D('ceilingHole', cx, cz, 0, { y: 3.1 });
    addProp3D('ceilingTileFallen', cx + 0.3, cz + 0.5, rnd() * 6.28);
  }
  addBlood(0, 14.5, 3.4, 'pool');
  addBlood(-0.6, 16.2, 2.6, 'drag');
  addWallBlood(-HALL_HALF + 0.12, 1.3, 18.0, Math.PI / 2, 1.6, 'handprint');
  addWallBlood(HALL_HALF - 0.12, 1.3, 12.0, -Math.PI / 2, 1.6, 'handprint');
  addProp3D('gurneyToppled', -1.2, 24.0, 0.25, { collide: [1.0, 1.6] });
  scatterDebris(0, (HALL_Z0 + HALL_Z1) / 2, HALL_HALF * 2 - 0.4, hallLen, 0.3);
  addLight(0, 2.9, 12, 'flicker', 0x3a4a52);
  addLight(0, 2.9, 26, 'pulse', 0x2e6a5a);
  for (const cz of [8, 15, 22, 29]) addProp3D('ceilingLight', 0, cz, 0, { y: 3.1, args: [cz === 15] });

  // ───────── 좌: 영안실 (x: -11 ~ -2.5) ─────────
  const morgueCx = -(HALL_HALF + (ROOM_X - HALL_HALF) / 2);
  addFloor(morgueCx, 17, ROOM_X - HALL_HALF, 26);
  addCeiling(morgueCx, 17, ROOM_X - HALL_HALF, 26);
  addWall(-ROOM_X, 17, WALL_T, 26);
  addWall(morgueCx, 4, ROOM_X - HALL_HALF, WALL_T);
  addWall(morgueCx, 30, ROOM_X - HALL_HALF, WALL_T);
  addSign(14, -HALL_HALF + 0.11, 1.62, 8.4, Math.PI / 2, 0.4, 0.16);   // 영안실 명패
  // 시체 보관 서랍 벽 — 캐비닛을 3단으로 쌓아 흉내낸다
  for (let i = 0; i < 7; i++) {
    const z = 7 + i * 3.2;
    for (let tier = 0; tier < 3; tier++) {
      addProp3D('cabinet', -ROOM_X + 0.5, z, Math.PI / 2,
        { y: tier * 1.26, collide: tier === 0 ? [0.5, 0.8] : null });
    }
    if (i % 2 === 0) addSearchable(-ROOM_X + 1.3, z, '보관 서랍');
  }
  for (let i = 0; i < 4; i++) {
    addProp3D('gurneyToppled', morgueCx + 1.5, 9 + i * 5.5, rnd() * 6.28, { collide: [1.0, 1.6] });
  }
  addProp3D('examTable', morgueCx - 1.0, 20, 0, { args: [3.2, 0.6], collide: [3.2, 0.65] });
  addBlood(morgueCx, 12, 3.0, 'pool');
  addBlood(morgueCx + 1.2, 22, 2.4);
  scatterDebris(morgueCx, 17, ROOM_X - HALL_HALF - 1.5, 24, 0.28);
  addLight(morgueCx, 2.85, 11, 'flicker', 0x2a4a58);
  addSpawn(morgueCx, 9); addSpawn(morgueCx, 17); addSpawn(morgueCx, 25);

  // ───────── 우: 기계실 (x: 2.5 ~ 11) ─────────
  const machCx = HALL_HALF + (ROOM_X - HALL_HALF) / 2;
  addFloor(machCx, 17, ROOM_X - HALL_HALF, 26);
  addCeiling(machCx, 17, ROOM_X - HALL_HALF, 26);
  addWall(ROOM_X, 17, WALL_T, 26);
  addWall(machCx, 4, ROOM_X - HALL_HALF, WALL_T);
  addWall(machCx, 30, ROOM_X - HALL_HALF, WALL_T);
  addSign(15, HALL_HALF - 0.11, 1.62, 8.4, -Math.PI / 2, 0.4, 0.16);   // 기계실 명패
  // 발전기·배전반 덩어리 (자판기 메시를 크게 재활용 — 형태가 배전함과 닮았다)
  for (const [x, z, r] of [[machCx + 2.2, 8, 0], [machCx + 2.2, 12, 0],
                           [machCx - 2.4, 26, Math.PI], [machCx + 2.0, 24, 0]]) {
    addProp3D('vendingMachine', x, z, r, { collide: [0.95, 0.8] });
  }
  addProp3D('cart', machCx, 18, 0.5, { collide: [0.7, 0.5] });
  addSearchable(machCx, 17.5, '공구 카트');
  addSearchable(machCx + 2.0, 20.5, '부품 상자');
  addProp3D('extinguisher', ROOM_X - 0.22, 15, -Math.PI / 2, { collide: [0.3, 0.3] });
  scatterDebris(machCx, 17, ROOM_X - HALL_HALF - 1.5, 24, 0.34);
  addBlood(machCx, 21, 2.6, 'splatter');
  addLight(machCx, 2.85, 20, 'flicker', 0x58402a);
  addSpawn(machCx, 8); addSpawn(machCx, 17); addSpawn(machCx, 26);

  // ───────── 발전기 이벤트 ─────────
  let pulled = 0;
  const total = GENERATOR.leverCount;

  const onPull = () => {
    pulled++;
    if (pulled < total) {
      // 소음이 좀비를 부른다 — 레버를 올릴 때마다 대가를 치른다 (SPEC §3)
      triggerWave(GENERATOR.waveOnLever);
      return `전원 ${pulled}/${total} — 소리가 났다`;
    }
    // 3개 완료: 불이 켜진다. 2초의 안도, 그리고 즉시 대규모 웨이브
    setMood({ ambientIntensity: GENERATOR.litAmbient, fogDensity: GENERATOR.litFog });
    setLights('steady', 1.6);
    bus.emit(EV.SFX, { name: 'flashlight', volume: 0.9 });
    setTimeout(() => {
      bus.emit(EV.HINT, { text: '계단실로 — 전부 몰려온다', duration: 4 });
      triggerWave(GENERATOR.waveOnComplete);
    }, GENERATOR.reliefSeconds * 1000);
    return '전원 복구 — 불이 들어왔다';
  };

  addLever(machCx + 3.3, 6.2, Math.PI, '전원 레버 A', onPull);
  addLever(ROOM_X - 0.3, 22.0, -Math.PI / 2, '전원 레버 B', onPull);
  addLever(machCx - 3.0, 29.2, 0, '전원 레버 C', onPull);

  // ───────── 탈출 계단실 (z: 30 ~ 38) ─────────
  addFloor(0, EXIT_Z, 9, 8); addCeiling(0, EXIT_Z, 9, 8);
  addWall(-4.5, EXIT_Z, WALL_T, 8);
  addWall(4.5, EXIT_Z, WALL_T, 8);
  addWall(0, EXIT_Z + 4, 9, WALL_T);
  addWall(-(HALL_HALF + gap / 2), 30, gap, WALL_T);
  addWall(HALL_HALF + gap / 2, 30, gap, WALL_T);
  addProp3D('stairs', 0, EXIT_Z + 3.5, Math.PI, { args: [6.0, 6], collide: [6.0, 1.1] });
  addLight(0, 2.85, EXIT_Z, 'steady', 0x2e7a4a);
  addSign(12, 0, 2.35, EXIT_Z + 3.85, Math.PI, 0.9, 0.36, true);
  addBlood(0, EXIT_Z - 1.5, 3.0, 'pool');
  scatterDebris(0, EXIT_Z, 7, 7, 0.4);
  addSpawn(-3, EXIT_Z); addSpawn(3, EXIT_Z);

  return {
    playerStart: { x: 0, z: ENTRY_Z - 1.2, yaw: Math.PI },
    exit: { x: 0, z: EXIT_Z + 2.2, radius: 2.2 },
  };
}
