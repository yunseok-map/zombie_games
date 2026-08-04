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
  ZOMBIE_DIED: 'zombie:died',
  WEAPON_FIRED: 'weapon:fired',
  WEAPON_CHANGED: 'weapon:changed',
  AMMO_CHANGED: 'ammo:changed',
  FLASHLIGHT_TOGGLED: 'flashlight:toggled',
  HINT: 'hint',                   // { text, duration }
  STAGE_LOADED: 'stage:loaded',
  SFX: 'sfx',                     // { name, x, z, volume }
};
