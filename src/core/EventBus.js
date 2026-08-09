/**
 * EventBus — 시스템 간 통신. core/ 가 게임 계층을 직접 참조하지 않기 위한 장치.
 * (CLAUDE.md §4 계층 규칙)
 */
class EventBus {
  constructor() { this.map = new Map(); }

  on(event, fn) {
    if (!this.map.has(event)) this.map.set(event, new Set());
    this.map.get(event).add(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    this.map.get(event)?.delete(fn);
  }

  emit(event, payload) {
    const set = this.map.get(event);
    if (!set) return;
    for (const fn of set) fn(payload);
  }

  clear() { this.map.clear(); }
}

export const bus = new EventBus();

/** 이벤트 이름 상수 — 오타 방지 */
export const EV = {
  NOISE: 'noise',                 // { x, z, radius, source }
  PLAYER_DAMAGED: 'player:damaged',
  PLAYER_DIED: 'player:died',
  // { x, y, z, nx, nz, power, headshot } — headshot 은 HUD 마커·화면흔들림이 읽는다.
  // power 로 구분하면 HUD 에 매직넘버(1.8)가 생긴다. 불리언을 그대로 보낸다.
  ZOMBIE_HIT: 'zombie:hit',
  MELEE_HIT: 'melee:hit',         // 근접이 **닿았을 때만**. 헛스윙에는 안 온다 (흔들림·히트스톱용)
  MELEE_CLANG: 'melee:clang',     // 근접이 **벽·소품**을 쳤을 때 { x, z }. 살을 칠 때보다 짧고 세게 튕긴다
  WALL_HIT: 'wall:hit',           // 빗나간 총알이 벽·바닥·천장에 박혔다 { x, y, z, nx, ny, nz }
  GRAB_START: 'grab:start',       // 좀비가 달라붙었다 { x, z }
  GRAB_END: 'grab:end',           // { broke } — true 면 뿌리친 것, false 면 시간 초과
  ZOMBIE_DIED: 'zombie:died',
  WEAPON_FIRED: 'weapon:fired',
  WEAPON_CHANGED: 'weapon:changed',
  AMMO_CHANGED: 'ammo:changed',
  // 재장전 중의 취약함이 이 게임의 공포 장치인데(CLAUDE.md §5-4) 그 2초를 화면이
  // 한 번도 표현하지 않았다. 링이 시계처럼 채워진다.
  RELOAD_START: 'reload:start',   // { seconds }
  RELOAD_END: 'reload:end',       // { cancelled }
  FLASHLIGHT_TOGGLED: 'flashlight:toggled',
  HINT: 'hint',                   // { text, duration }
  OBJECTIVE: 'objective',         // { text } — 계속 떠 있는 "지금 할 일". HINT 와 달리 안 사라진다
  STAGE_LOADED: 'stage:loaded',
  // B1 발전기 복구. **구역을 넘어 남는 유일한 상태**라 이벤트로 알린다 —
  // 위층은 이걸 받아 비상등을 켠 채로 시작한다 (stages/*.js 의 meta.poweredMood)
  POWER_RESTORED: 'power:restored',
  // 화면을 흔든다 { amount } — 0~1. 전투가 아닌 **사건**이 몸으로 느껴져야 할 때만
  // 쓴다 (옥상 신호탄이 머리 위에서 터지는 순간). 전투 흔들림은 이 이벤트를 쓰지
  // 않는다 — WEAPON_FIRED·MELEE_HIT 처럼 이미 있는 사건에 Player 가 직접 붙어 있다.
  SHAKE: 'fx:shake',
  SFX: 'sfx',                     // { name, x, z, volume }
};
