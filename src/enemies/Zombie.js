import * as THREE from 'three';
import { ZOMBIE, AI } from '../config/balance.js';
import { bus, EV } from '../core/EventBus.js';
import { requestZombieModel } from './ZombieModel.js';

/**
 * 모델 방향 보정.
 * facing 은 플레이어와 같은 규약을 쓴다 — 전진 방향이 (-sin, -cos), 즉 로컬 -Z.
 * (Zombie.js 239행: `const fx = -Math.sin(this.facing)`)
 * Mixamo 캐릭터는 +Z 를 보므로 180° 돌려야 진행 방향을 바라본다.
 * 이걸 0 으로 두면 좀비가 뒷걸음질로 다가온다.
 */
const MODEL_YAW = Math.PI;
const FADE = 0.22;            // 클립 전환 시간(초). 짧으면 뚝뚝 끊기고 길면 흐물거린다

const _tmp = new THREE.Vector3();

/**
 * Zombie — 개체 상태머신.
 * WANDER → (감지) → CHASE → (사거리) → ATTACK
 *              ↘ (소리) → ALERT → (도착) → SEARCH → WANDER
 *
 * NavMesh 없음. 직선 추격 + 3방향 레이 회피. (PROGRESS.md 알려진 함정)
 */
export class Zombie {
  constructor(scene) {
    this.scene = scene;
    this.active = false;
    this.pos = new THREE.Vector3();
    this.facing = 0;
    this.state = 'WANDER';

    // 임시 메시 — Mixamo GLB 들어오면 교체 (ASSETS.md §2)
    this.group = new THREE.Group();
    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0x5d6b58, roughness: 0.94, metalness: 0.02 });
    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 1.0, 4, 10), this.bodyMat);
    this.body.castShadow = true;
    this.body.position.y = 0.85;
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), this.bodyMat);
    this.head.castShadow = true;
    this.head.position.set(0, 1.55, 0.04);
    this.group.add(this.body, this.head);
    this.group.visible = false;
    scene.add(this.group);

    // GLB 가 준비되면 캡슐을 치우고 갈아끼운다. 실패해도 캡슐로 계속 돌아간다.
    this.model = null;
    this.mixer = null;
    this.actions = null;
    this.curAnim = null;
    this._prevX = 0; this._prevZ = 0; this._moveSpeed = 0;
    requestZombieModel((inst) => this._attachModel(inst));

    this.def = ZOMBIE.shambler;
    this._reset();
  }

  _attachModel({ root, mixer, actions }) {
    this.group.remove(this.body, this.head);
    this.body.geometry.dispose();
    this.head.geometry.dispose();
    root.rotation.y = MODEL_YAW;
    this.group.add(root);
    this.model = root;
    this.mixer = mixer;
    this.actions = actions;
  }

  /** 상태 → 클립 종류 */
  _animKey() {
    if (this.state === 'DEAD') return 'death';
    if (this.stun > 0) return 'hit';
    if (this.state === 'ATTACK') return 'attack';
    if (this.state === 'CHASE') return 'run';
    return this._moveSpeed > 0.25 ? 'walk' : 'idle';
  }

  _updateAnim(dt) {
    if (!this.mixer) return;

    // 실제 이동 속도 — 걷기/서기 판정과 재생속도에 쓴다
    const moved = Math.hypot(this.pos.x - this._prevX, this.pos.z - this._prevZ);
    this._moveSpeed = dt > 0 ? moved / dt : 0;
    this._prevX = this.pos.x; this._prevZ = this.pos.z;

    const key = this._animKey();
    const next = this.actions?.[key] ?? this.actions?.idle;
    if (next && next !== this.curAnim) {
      next.reset().fadeIn(FADE).play();
      if (this.curAnim) this.curAnim.fadeOut(FADE);
      this.curAnim = next;
    }
    // 걷기/달리기는 실제 속도에 맞춰 재생속도를 조절한다 (발이 미끄러지지 않게)
    if (next && (key === 'walk' || key === 'run')) {
      const ref = key === 'run' ? this.def.speedChase : this.def.speedWander;
      next.timeScale = THREE.MathUtils.clamp(this._moveSpeed / Math.max(ref, 0.1), 0.4, 2.2);
    } else if (next) {
      next.timeScale = 1;
    }

    this.mixer.update(dt);
  }

  _reset() {
    this.hp = 0;
    this.stun = 0;
    this.attackTimer = 0;
    this.loseTimer = 0;
    this.searchTimer = 0;
    this.stuckTimer = 0;
    this.bestDist = Infinity;
    this.target = { x: 0, z: 0 };
    this.wanderTimer = 0;
    this.deathTimer = 0;
    this.groanTimer = Math.random() * 6;
  }

  spawn(typeKey, x, z) {
    this.def = ZOMBIE[typeKey] ?? ZOMBIE.shambler;
    this.typeKey = typeKey;
    this._reset();
    this.hp = this.def.hp;
    this.pos.set(x, 0, z);
    this.facing = Math.random() * Math.PI * 2;
    this.state = 'WANDER';
    this.active = true;

    // 캡슐 폴백일 때만 색을 칠한다. 모델이 있으면 텍스처가 이미 있고,
    // 매 스폰마다 재질을 새로 만들면 그것 자체가 GC 부담이다.
    if (!this.model) {
      this.bodyMat = this.body.material = this.head.material =
        new THREE.MeshStandardMaterial({ color: this.def.color, roughness: 0.94, metalness: 0.02 });
    }

    // 사망 연출 잔재 초기화
    this.group.rotation.set(0, this.facing, 0);
    this.group.position.y = 0;
    this.mixer?.stopAllAction();
    this.curAnim = null;
    this._prevX = x; this._prevZ = z; this._moveSpeed = 0;

    const scale = this.def.height / 1.75;
    this.group.scale.setScalar(scale);
    this.group.visible = true;
    this._syncMesh();
  }

  despawn() {
    this.active = false;
    this.group.visible = false;
  }

  /** 소리를 들었다 — Director 가 라우팅한다 */
  hear(x, z, radius) {
    if (!this.active || this.state === 'DEAD') return;
    const d = Math.hypot(x - this.pos.x, z - this.pos.z);
    const effective = Math.min(radius, this.def.hearRange * (radius > 20 ? 2.4 : 1));
    if (d > effective) return;
    if (this.state === 'CHASE') return;
    this.target.x = x; this.target.z = z;
    this.state = 'ALERT';
    this.searchTimer = AI.searchTime;
  }

  hit(damage, stun = 0, headshot = false) {
    if (!this.active || this.state === 'DEAD') return;
    this.hp -= damage;
    this.stun = Math.max(this.stun, stun / (this.def.stunResist || 1));
    if (headshot) this.stun += 0.15;

    if (this.hp <= 0) {
      this.state = 'DEAD';
      this.deathTimer = 1.2;
      bus.emit(EV.SFX, { name: 'zombie_death', x: this.pos.x, z: this.pos.z, volume: 0.8 });
      bus.emit(EV.ZOMBIE_DIED, { x: this.pos.x, z: this.pos.z, type: this.typeKey });
    } else if (this.state !== 'CHASE') {
      this.state = 'CHASE';
      bus.emit(EV.SFX, { name: 'zombie_alert', x: this.pos.x, z: this.pos.z, volume: 0.9 });
    }
  }

  update(dt, ctx) {
    if (!this.active) return;
    const { player, collision, detectionMul, zombies } = ctx;

    if (this.state === 'DEAD') {
      this.deathTimer -= dt;
      if (!this.model) {
        // 캡슐 폴백 — 손으로 눕힌다. 모델이 있으면 death 클립이 대신한다
        this.group.rotation.x = Math.min(Math.PI / 2, (1.2 - this.deathTimer) * 2.2);
        this.group.position.y = -Math.min(0.5, (1.2 - this.deathTimer) * 0.6);
      }
      this._updateAnim(dt);
      if (this.deathTimer <= 0) this.despawn();
      return;
    }

    this.groanTimer -= dt;
    if (this.groanTimer <= 0) {
      this.groanTimer = 5 + Math.random() * 9;
      bus.emit(EV.SFX, { name: 'zombie_groan', x: this.pos.x, z: this.pos.z, volume: 0.55 });
    }

    if (this.stun > 0) { this.stun -= dt; this._syncMesh(); this._updateAnim(dt); return; }

    const dx = player.pos.x - this.pos.x;
    const dz = player.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const canSee = this._canSee(dx, dz, dist, collision, detectionMul);

    switch (this.state) {
      case 'WANDER': this._wander(dt, collision); if (canSee) this._startChase(); break;
      case 'ALERT':  this._goTo(dt, this.target.x, this.target.z, collision, zombies, this.def.speedWander * 1.5);
                     if (canSee) this._startChase();
                     else if (Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z) < 1.2) {
                       this.state = 'SEARCH'; this.searchTimer = AI.searchTime;
                     }
                     break;
      case 'SEARCH': this._wander(dt, collision);
                     this.searchTimer -= dt;
                     if (canSee) this._startChase();
                     else if (this.searchTimer <= 0) this.state = 'WANDER';
                     break;
      case 'CHASE':  this._chase(dt, player, dist, canSee, collision, zombies); break;
      case 'ATTACK': this._attack(dt, player, dist); break;
    }

    this._syncMesh();
    this._updateAnim(dt);
  }

  _startChase() {
    if (this.state !== 'CHASE') {
      bus.emit(EV.SFX, { name: 'zombie_alert', x: this.pos.x, z: this.pos.z, volume: 0.9 });
    }
    this.state = 'CHASE';
    this.loseTimer = AI.chaseGiveUpTime;
    this.stuckTimer = 0;
    this.bestDist = Infinity;
  }

  _canSee(dx, dz, dist, collision, detectionMul) {
    const range = this.def.sightRange * detectionMul;
    if (range <= 0 || dist > range) return false;
    const fx = -Math.sin(this.facing), fz = -Math.cos(this.facing);
    const dot = (dx / dist) * fx + (dz / dist) * fz;
    const halfAngle = Math.cos(THREE.MathUtils.degToRad(this.def.sightAngleDeg) / 2);
    if (dot < halfAngle) return false;
    return !collision.segmentBlocked(this.pos.x, this.pos.z, this.pos.x + dx, this.pos.z + dz);
  }

  _wander(dt, collision) {
    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0) {
      this.wanderTimer = 2 + Math.random() * 4;
      this.facing += (Math.random() - 0.5) * 2.4;
    }
    this._step(dt, -Math.sin(this.facing), -Math.cos(this.facing), this.def.speedWander, collision, null);
  }

  _chase(dt, player, dist, canSee, collision, zombies) {
    if (canSee) {
      this.loseTimer = AI.chaseGiveUpTime;
      this.target.x = player.pos.x; this.target.z = player.pos.z;
    } else {
      this.loseTimer -= dt;
      if (this.loseTimer <= 0) { this.state = 'SEARCH'; this.searchTimer = AI.searchTime; return; }
    }

    if (dist <= this.def.attackRange) { this.state = 'ATTACK'; this.attackTimer = 0; return; }

    // 벽에 껴서 영원히 접근 못 하는 개체를 회수한다
    if (dist < this.bestDist - 0.4) { this.bestDist = dist; this.stuckTimer = 0; }
    else { this.stuckTimer += dt; if (this.stuckTimer > AI.stuckTimeout) { this.despawn(); return; } }

    this._goTo(dt, this.target.x, this.target.z, collision, zombies, this.def.speedChase);
  }

  _attack(dt, player, dist) {
    this.attackTimer -= dt;
    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
    this.facing = Math.atan2(-dx, -dz);

    if (dist > this.def.attackRange * 1.35) { this.state = 'CHASE'; return; }
    if (this.attackTimer <= 0) {
      this.attackTimer = this.def.attackCooldown;
      player.damage(this.def.damage);
      bus.emit(EV.SFX, { name: 'zombie_attack', x: this.pos.x, z: this.pos.z, volume: 1 });
    }
  }

  _goTo(dt, tx, tz, collision, zombies, speed) {
    let dx = tx - this.pos.x, dz = tz - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d; dz /= d;

    // 3방향 레이 회피 — 정면이 막히면 좌/우로 튼다
    if (collision.segmentBlocked(this.pos.x, this.pos.z,
        this.pos.x + dx * AI.avoidRayLength, this.pos.z + dz * AI.avoidRayLength)) {
      const base = Math.atan2(dx, dz);
      let found = false;
      for (const off of [0.7, -0.7, 1.4, -1.4, 2.2, -2.2]) {
        const a = base + off;
        const ax = Math.sin(a), az = Math.cos(a);
        if (!collision.segmentBlocked(this.pos.x, this.pos.z,
            this.pos.x + ax * AI.avoidRayLength, this.pos.z + az * AI.avoidRayLength)) {
          dx = ax; dz = az; found = true; break;
        }
      }
      if (!found) { dx = -dx; dz = -dz; }
    }

    this.facing = Math.atan2(-dx, -dz);
    this._step(dt, dx, dz, speed, collision, zombies);
  }

  _step(dt, dx, dz, speed, collision, zombies) {
    // 좀비끼리 겹치지 않게 밀어낸다
    if (zombies) {
      for (const o of zombies) {
        if (o === this || !o.active || o.state === 'DEAD') continue;
        const ox = this.pos.x - o.pos.x, oz = this.pos.z - o.pos.z;
        const od = Math.hypot(ox, oz);
        if (od < AI.separation && od > 1e-4) {
          dx += (ox / od) * 0.7; dz += (oz / od) * 0.7;
        }
      }
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    }

    const nx = this.pos.x + dx * speed * dt;
    const nz = this.pos.z + dz * speed * dt;
    const r = collision.resolve(nx, nz, this.def.radius);
    this.pos.x = r.x; this.pos.z = r.z;
  }

  _syncMesh() {
    this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
    if (this.state !== 'DEAD') {
      this.group.rotation.y = this.facing;
      if (!this.model) {
        // 캡슐 폴백의 걷는 느낌. 진짜 애니메이션이 있으면 흔들면 안 된다
        const moving = this.state === 'CHASE' || this.state === 'ALERT' || this.state === 'WANDER';
        this.group.rotation.z = moving ? Math.sin(performance.now() * 0.006 + this.pos.x) * 0.07 : 0;
      }
    }
  }
}
