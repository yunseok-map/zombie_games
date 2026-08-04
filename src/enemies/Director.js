import { DIRECTOR, GAME } from '../config/balance.js';
import { bus, EV } from '../core/EventBus.js';

/**
 * Director — 좀비를 "최대치"가 아니라 "연출된 수"로 등장시킨다. (SPEC.md §5)
 *
 *   BUILDUP  긴장도가 오른다. 조금씩, 멀리서 등장
 *   PEAK     웨이브. 몰아친다
 *   RELIEF   스폰 정지. 정적 — 이 구간이 있어야 다음 PEAK 가 무섭다
 *
 * 하드캡(14)은 성능 상한이지 목표치가 아니다. 평소엔 훨씬 적게 유지한다.
 */
export class Director {
  constructor(pool, player, collision) {
    this.pool = pool;
    this.player = player;
    this.collision = collision;

    this.tension = DIRECTOR.tensionStart;
    this.phase = 'BUILDUP';
    this.phaseTime = 0;
    this.spawnTimer = 0;
    this.spawnPoints = [];
    this.typeWeights = { shambler: 1 };
    this.enabled = true;
    this.pendingWave = 0;
    this.pendingWaveType = null;      // null = 구역 typeWeights 를 따른다

    // 소리는 좀비를 부른다
    bus.on(EV.NOISE, (n) => this.pool.broadcastNoise(n.x, n.z, n.radius));
    // 처치하면 긴장이 조금 풀린다 (보상감)
    bus.on(EV.ZOMBIE_DIED, () => { this.tension = Math.max(0, this.tension - 3.5); });
    // 맞으면 긴장이 오른다
    bus.on(EV.PLAYER_DAMAGED, () => { this.tension = Math.min(DIRECTOR.tensionMax, this.tension + 5); });
  }

  /** StageLoader 가 구역 로드 시 호출 */
  setStage(spawnPoints, typeWeights = { shambler: 1 }) {
    this.spawnPoints = spawnPoints;
    this.typeWeights = typeWeights;
    this.tension = DIRECTOR.tensionStart;
    this.phase = 'BUILDUP';
    this.phaseTime = 0;
    this.spawnTimer = 1.5;
  }

  /**
   * 이벤트용 강제 웨이브 (발전기 레버 등).
   * @param typeKey 생략하면 **구역의 typeWeights 를 따른다.** 예전에는 'shambler' 로
   *   고정돼 있어서, 청각체·포복체를 등록해도 이벤트 웨이브는 전부 배회체만 나왔다.
   */
  triggerWave(count, typeKey = null) {
    this.pendingWave += count;
    this.pendingWaveType = typeKey;
    this.phase = 'PEAK';
    this.phaseTime = 0;
    this.tension = DIRECTOR.tensionMax;
    this.spawnTimer = 0;
  }

  update(dt) {
    if (!this.enabled || !this.player.alive) return;
    this.phaseTime += dt;
    const diff = GAME.difficultyMultiplier;

    // ── 긴장도 ──
    switch (this.phase) {
      case 'BUILDUP':
        this.tension += DIRECTOR.buildupRate * diff * dt;
        if (this.tension >= DIRECTOR.peakThreshold) this._setPhase('PEAK');
        break;
      case 'PEAK':
        this.tension -= DIRECTOR.peakDecay * dt;
        if (this.tension <= DIRECTOR.reliefThreshold && this.pendingWave <= 0) this._setPhase('RELIEF');
        break;
      case 'RELIEF':
        this.tension = Math.max(0, this.tension - DIRECTOR.reliefDecay * dt);
        if (this.phaseTime >= DIRECTOR.reliefDuration) this._setPhase('BUILDUP');
        break;
    }
    this.tension = Math.max(0, Math.min(DIRECTOR.tensionMax, this.tension));

    // ── 스폰 ──
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;

    const active = this.pool.activeCount;
    if (active >= DIRECTOR.hardCapActive) { this.spawnTimer = 1; return; }

    let target = DIRECTOR.targets[this.phase] * diff;
    // 자비 보정 — 플레이어가 힘들면 자동으로 줄인다 (SPEC.md §5)
    if (this.player.hp < DIRECTOR.mercyHpThreshold) target *= DIRECTOR.mercyMultiplier;

    const wantWave = this.pendingWave > 0;
    if (!wantWave && active >= Math.round(target)) { this.spawnTimer = 1.2; return; }

    const point = this._pickSpawnPoint();
    if (!point) { this.spawnTimer = 0.8; return; }

    // 웨이브라도 타입을 지정하지 않았으면 구역 가중치를 따른다
    const type = (wantWave && this.pendingWaveType) ? this.pendingWaveType : this._pickType();
    const z = this.pool.spawn(type, point.x, point.z);
    if (z && wantWave) {
      this.pendingWave--;
      z.hear(this.player.pos.x, this.player.pos.z, 999);   // 웨이브 좀비는 곧장 온다
    }

    this.spawnTimer = wantWave ? 0.32 : DIRECTOR.spawnInterval[this.phase] * (0.7 + Math.random() * 0.6);
  }

  _setPhase(p) {
    this.phase = p;
    this.phaseTime = 0;
    if (p === 'PEAK') this.spawnTimer = 0;
  }

  _pickType() {
    const entries = Object.entries(this.typeWeights);
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    for (const [key, w] of entries) { r -= w; if (r <= 0) return key; }
    return entries[0][0];
  }

  /**
   * 플레이어 시야 밖 + 적당한 거리의 지점만 고른다.
   * "뿅 하고 눈앞에 나타나는" 것이 몰입을 가장 크게 깬다.
   */
  _pickSpawnPoint() {
    if (!this.spawnPoints.length) return null;
    const px = this.player.pos.x, pz = this.player.pos.z;
    const fwd = this.player.getForward();
    const candidates = [];

    for (const p of this.spawnPoints) {
      const dx = p.x - px, dz = p.z - pz;
      const d = Math.hypot(dx, dz);
      if (d < DIRECTOR.spawnMinDistance || d > DIRECTOR.spawnMaxDistance) continue;

      if (DIRECTOR.spawnOnlyOutOfView) {
        const dot = (dx / d) * fwd.x + (dz / d) * fwd.z;
        const behind = dot < 0.25;                                  // 시야 밖이거나
        const occluded = this.collision.segmentBlocked(px, pz, p.x, p.z); // 벽 뒤
        if (!behind && !occluded) continue;
      }
      if (this.collision.isBlocked(p.x, p.z, 0.5)) continue;
      candidates.push(p);
    }

    if (!candidates.length) return null;
    return candidates[(Math.random() * candidates.length) | 0];
  }

  /** HUD/디버그용 */
  get debugInfo() {
    return `${this.phase} ${this.tension.toFixed(0)} / active ${this.pool.activeCount}`;
  }
}
