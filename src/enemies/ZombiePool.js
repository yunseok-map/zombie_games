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
    const z0 = this.all.find((z) => !z.active);
    if (!z0) return null;
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
