import { bus, EV } from '../core/EventBus.js';
import { NOISE } from '../config/balance.js';

/**
 * Interaction — E 키로 만지는 것들 (아이템 · 문).
 *
 * 구역 정의(stages/*.js)는 "무엇을 어디에" 만 말하고, 실제 판정은 전부 여기서 한다.
 * 대상은 거리로만 고른다 — 어두워서 조준으로 고르게 하면 답답하다.
 */
export class Interaction {
  constructor() {
    this.list = [];
    this.anims = [];          // 열리는 중인 문
  }

  reset() { this.list.length = 0; this.anims.length = 0; }

  /** 문이 옆으로 미끄러지게 한다. 순간이동하면 버그처럼 보인다 */
  slide(mesh, dx, dz, duration = 0.9) {
    this.anims.push({
      mesh, t: 0, duration,
      from: mesh.position.clone(),
      dx, dz,
    });
  }

  update(dt) {
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i];
      a.t = Math.min(1, a.t + dt / a.duration);
      const e = 1 - Math.pow(1 - a.t, 3);        // ease-out
      a.mesh.position.set(a.from.x + a.dx * e, a.from.y, a.from.z + a.dz * e);
      if (a.t >= 1) this.anims.splice(i, 1);
    }
  }

  /**
   * @param {object} e
   *   x, z        위치
   *   radius      상호작용 사거리 (m)
   *   prompt      (state) => string | null   — null 이면 지금은 쓸 수 없다
   *   onUse       (state) => string | void   — 반환한 문자열은 힌트로 표시된다
   *   once        true 면 한 번 쓰고 사라진다
   *   mesh        once 로 사라질 때 같이 지울 메시 (선택)
   */
  add(e) {
    this.list.push({ radius: 2.0, once: false, ...e, used: false });
    return this.list[this.list.length - 1];
  }

  /** 사거리 안에서 가장 가까운 대상. 없으면 null */
  findTarget(px, pz) {
    let best = null, bestD2 = Infinity;
    for (const e of this.list) {
      if (e.used) continue;
      const dx = e.x - px, dz = e.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 > e.radius * e.radius || d2 >= bestD2) continue;
      best = e; bestD2 = d2;
    }
    return best;
  }

  /**
   * E 를 눌렀을 때. state 는 { player }.
   * onUse 반환값: 문자열이면 성공 메시지, `{ msg, done }` 이면 done 이 소모 여부.
   * 잠긴 문을 카드키 없이 눌렀을 때 소모되면 안 되므로 이 구분이 필요하다.
   */
  use(target, state) {
    if (!target || target.used) return;
    const res = target.onUse?.(state);
    const { msg = null, done = target.once } =
      (typeof res === 'string' || res == null) ? { msg: res } : res;

    if (done) {
      target.used = true;
      if (target.mesh) {
        target.mesh.removeFromParent();
        target.mesh.geometry.dispose();
      }
      // 문·레버는 소리가 난다 (SPEC.md §5 — 소리 반경 20m)
      if (target.noisy) {
        bus.emit(EV.NOISE, { x: target.x, z: target.z, radius: NOISE.interact, source: 'interact' });
      }
    }
    if (msg) bus.emit(EV.HINT, { text: msg, duration: 2.5 });
  }
}
