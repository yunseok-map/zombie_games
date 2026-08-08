/**
 * balance.js — 모든 밸런스 수치는 여기에만 존재한다. (CLAUDE.md §1-1)
 * 다른 파일에 매직넘버를 넣지 마라. 값만 고쳐서 게임 느낌을 바꿀 수 있어야 한다.
 * 단위: 거리 = 미터(1 unit = 1m), 시간 = 초
 *
 * ── 2026-08-08: 1,291줄이 되어 도메인별로 갈랐다 ──────────────────────────
 * "코드를 못 읽어도 이 파일 하나만 열면 조정할 수 있다"가 원래 의도였는데
 * 1,291줄이면 그게 성립하지 않는다. 아래 다섯 파일로 나눴다.
 *
 *   balance/player.js   이동 · 손전등 · 은신 · 부상 · 소음 · 체크포인트
 *   balance/zombie.js   좀비 종류 · AI · 애니메이션 · 공격 · 시체 · 스폰
 *   balance/combat.js   무기 · 타격 · 넉백 · 화면 흔들림
 *   balance/render.js   분위기 · 후처리 · 산포 · HUD 연출 · 성능 예산
 *   balance/world.js    치수 · 전리품 · 구역 이벤트 · 오디오
 *
 * **임포트 경로는 바뀌지 않았다.** 여기서 전부 다시 내보내므로 게임 코드는
 * 예전처럼 `from '../config/balance.js'` 를 그대로 쓴다. 고칠 파일이 없다.
 */

export * from './balance/player.js';
export * from './balance/zombie.js';
export * from './balance/combat.js';
export * from './balance/render.js';
export * from './balance/world.js';
