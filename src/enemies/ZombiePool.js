import { Zombie } from './Zombie.js';
import { DIRECTOR } from '../config/balance.js';

/**
 * ZombiePool — 런타임에 new Zombie() 를 호출하지 않기 위한 풀. (CLAUDE.md §3)
 * 미리 만들어두고 켜고 끈다. GC 스파이크가 사라진다.
 */
export class ZombiePool {
  constructor(scene, size = DIRECTOR.poolSize) {
    this.all = [];
    for (let i = 0; i < size; i++) this.all.push(new Zombie(scene));
  }

  get activeCount() {
    let n = 0;
    for (const z of this.all) if (z.active && z.state !== 'DEAD') n++;
    return n;
  }

  /** 활성 좀비만 (전투/사격 판정용) */
  getActive() {
    return this.all.filter((z) => z.active);
  }

  spawn(typeKey, x, z) {
    let z0 = this.all.find((z) => !z.active);
    // 빈 자리가 없으면 **가장 오래된 시체**를 재활용한다. 시체가 오래 남게 해 두면
    // 풀(20)이 시체로 차서 새 좀비가 안 나오는 일이 생긴다 — 화면에는 아무 일도
    // 안 일어나는데 압박만 사라진다.
    if (!z0) {
      const corpses = this.all.filter((z) => z.state === 'DEAD');
      if (!corpses.length) return null;
      z0 = corpses.reduce((a, b) => (a.deathTimer < b.deathTimer ? a : b));
    }
    z0.spawn(typeKey, x, z);
    return z0;
  }

  despawnAll() {
    for (const z of this.all) z.despawn();
  }

  update(dt, ctx) {
    ctx.zombies = this.all;
    for (const z of this.all) if (z.active) z.update(dt, ctx);
  }

  broadcastNoise(x, zz, radius) {
    for (const z of this.all) if (z.active) z.hear(x, zz, radius);
  }
}
