import { GENERATOR } from '../../config/balance.js';
import { bus, EV } from '../../core/EventBus.js';
import { makeRng } from '../rng.js';

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
  objective: '전원 레버 3개를 올려 불을 켜라',
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
  // addPropGLB 가 빠져 있었다 — 그래서 영안실인데 시체 서랍장·시체가방·시신 GLB 를
  // 하나도 못 쓰고 캐비닛을 3단으로 쌓아 흉내내고 있었다. (PROGRESS.md 함정 참고)
  const { addWall, addFloor, addCeiling, addLight, addSpawn, addBlood, addWallBlood,
          scatterDebris, addProp3D, addPropGLB, addSign, addSearchable, addWeapon, addLever,
          triggerWave, setMood, setLights,
          wallWithDoors } = ctx;

  const rnd = makeRng(90211);
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
    wallWithDoors('z', sx * HALL_HALF, HALL_Z0, HALL_Z1, doors, { t: WALL_T });
    for (const dz of doors) {
      addProp3D('doorFrame', sx * HALL_HALF, dz, Math.PI / 2, { args: [1.6, 2.1, 0.3] });
      addProp3D('doorFallen', sx * HALL_HALF - sx * 0.8, dz + 0.3, Math.PI / 2 + sx * 0.4,
        { args: [1.5, 2.05] });                       // B1 의 문은 전부 뜯겨 있다
    }
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
  // 영안실이 넘쳐서 통로까지 시신을 내놓았다. 플레이어는 **이 사이를 지나가야 한다** —
  // 지나가는 동안 시선이 계속 아래로 끌린다. 이 구역에서 가장 오래 남는 그림이다.
  //
  // **시체가방에는 충돌을 걸지 않는다.** 높이가 0.33m — 무릎 높이라 넘어가는 게 정상인데,
  // Collision 은 XZ 전용이라 박스를 걸면 천장까지 닿는 보이지 않는 벽이 된다.
  // 다른 네 구역은 원래부터 충돌 없이 놓고 있었고, B1 만 걸려 있어서
  // **영안실에서만 시신 앞이 막혔다.** (PROGRESS.md 알려진 함정)
  for (const bz of [5.6, 7.8, 26.2, 28.4]) {
    addPropGLB('prop_bodybag', -HALL_HALF + 0.62, bz, 0);
  }
  addPropGLB('prop_ventilator', HALL_HALF - 0.5, 18.6, -Math.PI / 2, { collide: [0.65, 0.65] });
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
  // 시체 보관 서랍 벽 — 진짜 영안실 락커 GLB (3.27 x 2.20 x 2.39m).
  // yaw 90도로 눕혀 문이 방 안쪽(+x)을 보게 하고, 서쪽 벽에 붙인다.
  for (let i = 0; i < 5; i++) {
    const z = 7.6 + i * 3.5;
    addPropGLB('prop_morgue_lockers', -ROOM_X + 1.3, z, Math.PI / 2, { collide: [2.4, 3.3] });
    if (i % 2 === 0) addSearchable(-ROOM_X + 2.9, z, '보관 서랍');
  }

  // **여기가 이 구역의 그림이다** — 락커가 다 차서 시신을 바닥에 늘어놓았다.
  // 줄지어 놓인 시체가방은 "얼마나 많이 죽었는가"를 숫자 대신 길이로 보여준다.
  // 간격 2.4m 에 충돌 박스 깊이가 2.0m 였다 — **틈이 0.4m 밖에 안 남는데
  // 플레이어 반지름이 0.35m 다.** 여섯 개가 이어져 12m 짜리 벽이 되어 있었다.
  for (let i = 0; i < 6; i++) {
    addPropGLB('prop_bodybag', morgueCx + 2.6, 8.0 + i * 2.4, 0);
  }
  // 한 줄은 흐트러져 있다 — 열려 있고, 안이 비었다. 뭔가 걸어 나갔다.
  addPropGLB('prop_bodybag', morgueCx + 0.7, 11.2, 0.42);
  addPropGLB('prop_bodybag', morgueCx + 0.2, 19.6, -0.30);
  addBlood(morgueCx + 0.7, 12.6, 2.0, 'drag');          // 가방에서 기어 나간 자국

  // 부검대와 시신 — 작업 중이었다는 것이 읽혀야 한다
  addPropGLB('prop_autopsy_table', morgueCx - 1.2, 20.0, Math.PI / 2, { collide: [0.8, 2.0] });
  addPropGLB('prop_corpse', morgueCx - 1.2, 20.0, Math.PI / 2, { y: 0.95 });
  addBlood(morgueCx - 1.2, 20.0, 1.6, 'pool', 0.96);
  addPropGLB('prop_sink', -ROOM_X + 0.45, 27.4, Math.PI / 2, { collide: [0.6, 0.7] });
  addPropGLB('prop_mop_bucket', morgueCx - 2.6, 27.8, 0.6, { collide: [0.8, 0.5] });

  // 시야를 끊는 배치 — 손전등이 방 전체를 한 번에 훑지 못하게 가운데를 막는다
  for (let i = 0; i < 4; i++) {
    addProp3D('gurneyToppled', morgueCx + 1.5, 9 + i * 5.5, rnd() * 6.28, { collide: [1.0, 1.6] });
  }
  addProp3D('curtain', morgueCx + 0.6, 16.4, 0, { args: [2.6, 2.1] });   // 반쯤 쳐진 칸막이
  addProp3D('curtain', morgueCx - 2.0, 24.2, Math.PI / 2, { args: [2.2, 2.1] });
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
  // 배전반 — 전원 레버를 찾아 헤매는 구역인데 정작 배전반이 하나도 없었다.
  // 벽을 따라 늘어놓으면 "여기가 전기를 다루는 곳"이 한눈에 읽힌다.
  for (const pz of [10, 13.2, 18.4]) {
    addPropGLB('prop_panel', ROOM_X - 0.62, pz, -Math.PI / 2, { collide: [0.5, 0.85] });
  }
  addPropGLB('prop_water_cooler', HALL_HALF + 0.7, 12.2, 0, { collide: [0.4, 0.4] });
  addPropGLB('prop_mop_bucket', machCx - 2.6, 7.4, 0.9, { collide: [0.8, 0.5] });
  addProp3D('cart', machCx, 18, 0.5, { collide: [0.7, 0.5] });
  addSearchable(machCx, 17.5, '공구 카트');
  addSearchable(machCx + 2.0, 20.5, '부품 상자');
  // 기계실 바닥의 쇠지렛대. 파이프보다 느리지만 한 방이 크고 기절이 길다 —
  // 여기서부터 "한 마리씩 확실히 처리한다"는 선택지가 생긴다
  addWeapon(machCx + 1.0, 22.6, 'crowbar', '쇠지렛대');
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
      bus.emit(EV.OBJECTIVE, { text: `전원 레버 ${pulled}/${total} — 남은 레버를 찾아라` });
      return `전원 ${pulled}/${total} — 소리가 났다`;
    }
    // 3개 완료: 불이 켜진다. 2초의 안도, 그리고 즉시 대규모 웨이브
    setMood({ ambientIntensity: GENERATOR.litAmbient, fogDensity: GENERATOR.litFog });
    setLights('steady', 1.6);
    bus.emit(EV.SFX, { name: 'flashlight', volume: 0.9 });
    bus.emit(EV.OBJECTIVE, { text: '전원 복구 — 계단실로' });
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
