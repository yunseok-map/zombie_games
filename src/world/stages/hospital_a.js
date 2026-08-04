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

export function build(ctx) {
  const { addWall, addFloor, addCeiling, addProp, addLight, addSpawn } = ctx;

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
  addProp(-4.5, -12, 3.4, 1.0, 1.1, 0x4a4136);          // 접수 데스크
  addProp(4.2, -13, 1.0, 0.9, 3.0, 0x3e4a45);           // 대기 의자열
  addProp(4.2, -8.5, 1.0, 0.9, 3.0, 0x3e4a45);
  addProp(0, -15.2, 4.0, 1.6, 0.5, 0x5a4a3a);           // 정문 바리케이드
  addProp(-6.6, -3.2, 0.7, 1.1, 0.7, 0x2f3a34);         // 자판기
  addLight(0, 2.85, -11, 'flicker');
  addLight(-5, 2.85, -4, 'pulse', 0x2e6a5a);
  addSpawn(-6.5, -14); addSpawn(6.5, -14); addSpawn(6.8, -4);

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

      // 병실 소품 — 4종 프리셋을 회전시켜 재사용 (모듈 반복의 핵심)
      const preset = (i + side) % 4;
      const bx = roomCx + sx * 1.4;
      if (preset === 0) {
        addProp(bx, zc - 1.6, 0.9, 0.55, 2.0, 0x59606b);   // 침대
        addProp(bx, zc + 1.6, 0.9, 0.55, 2.0, 0x59606b);
        addProp(roomCx - sx * 1.9, zc, 0.5, 1.2, 0.5, 0x3d4348);
      } else if (preset === 1) {
        addProp(bx, zc, 0.9, 0.55, 2.0, 0x59606b);
        addProp(roomCx, zc + 2.4, 2.4, 1.9, 0.45, 0x434a44); // 넘어진 캐비닛
      } else if (preset === 2) {
        addProp(roomCx, zc - 2.0, 3.6, 0.95, 0.6, 0x4a4f45); // 검사대
        addProp(bx, zc + 1.8, 0.7, 1.4, 0.7, 0x2f3a34);
      } else {
        addProp(bx, zc - 1.5, 0.9, 0.55, 2.0, 0x59606b);
        addProp(roomCx - sx * 1.8, zc + 1.2, 0.65, 1.0, 0.65, 0x6a5a3a); // 휠체어
      }

      addSpawn(roomCx, zc);
      if (i % 2 === 0) addLight(roomCx, 2.85, zc, i % 4 === 0 ? 'flicker' : 'steady', 0x3a4a52);
    }
  }

  // 복도 조명 — 드문드문. 어두운 구간이 있어야 손전등이 의미를 갖는다
  for (let i = 0; i < ROOM_COUNT; i++) {
    if (i % 2 === 1) continue;
    addLight(0, 2.9, i * ROOM_PITCH + ROOM_PITCH / 2, 'flicker');
  }

  // 복도 장애물 — 시야를 끊어 긴장을 만든다
  addProp(-0.9, 12.5, 1.6, 1.2, 0.7, 0x4a4136);
  addProp(1.1, 26.0, 1.4, 1.5, 0.8, 0x3e4a45);
  addProp(0, 34.5, 2.2, 0.9, 0.6, 0x5a4a3a);

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
  addProp(0, stZ + 3.2, 6.0, 1.2, 1.0, 0x3f453f);       // 계단 (탈출구 표식)
  addLight(0, 2.85, stZ, 'steady', 0x2e7a4a);
  addSpawn(-3, stZ); addSpawn(3, stZ);

  return {
    playerStart: { x: 0, z: -11, yaw: Math.PI },   // 로비에서 복도(+Z) 를 바라본다
    exit: { x: 0, z: stZ + 2, radius: 2.2 },
  };
}

export const WALL_HEIGHT = WALL_H;
