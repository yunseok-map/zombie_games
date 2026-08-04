import * as THREE from 'three';
import { WORLD, PLAYER, NOISE } from '../config/balance.js';
import { bus, EV } from '../core/EventBus.js';

/**
 * Player — 1인칭 이동 · 체력 · 스태미나.
 * 캐릭터 모델이 없다(1인칭 확정). 그래서 리깅/애니메이션이 필요 없다.
 */
export class Player {
  constructor(camera, input, collision) {
    this.camera = camera;
    this.input = input;
    this.collision = collision;

    this.pos = new THREE.Vector3(0, 0, 0);   // 발 위치 (y = 바닥)
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;

    this.hp = PLAYER.maxHp;
    this.stamina = PLAYER.maxStamina;
    this.crouching = false;
    this.sprinting = false;
    this.alive = true;
    this.items = new Set();    // 카드키 같은 열쇠 아이템 (무기는 WeaponSystem 이 갖는다)

    this.eyeHeight = WORLD.eyeHeight;
    this._bobPhase = 0;
    this._stepAccum = 0;
    this._invuln = 0;
    this._exhausted = false;   // 스태미나 0 찍으면 일정선까지 회복해야 다시 달림
  }

  spawn(x, z, yaw = 0) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.hp = PLAYER.maxHp;
    this.stamina = PLAYER.maxStamina;
    this.alive = true;
    this.items.clear();        // 재시작하면 구역도 다시 만들어지므로 아이템도 초기화한다
    this._invuln = 0;
    this._syncCamera(0);
  }

  get speed() { return Math.hypot(this.vel.x, this.vel.z); }

  update(dt) {
    if (!this.alive) return;
    this._look();
    this._move(dt);
    this._stamina(dt);
    this._footsteps(dt);
    if (this._invuln > 0) this._invuln -= dt;
    this._syncCamera(dt);
  }

  _look() {
    this.yaw -= this.input.mouseDX * PLAYER.mouseSensitivity;
    this.pitch -= this.input.mouseDY * PLAYER.mouseSensitivity;
    const lim = Math.PI / 2 - 0.02;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  _move(dt) {
    const inp = this.input;
    let fx = 0, fz = 0;
    if (inp.down('KeyW')) fz -= 1;
    if (inp.down('KeyS')) fz += 1;
    if (inp.down('KeyA')) fx -= 1;
    if (inp.down('KeyD')) fx += 1;

    const len = Math.hypot(fx, fz);
    if (len > 0) { fx /= len; fz /= len; }

    this.crouching = inp.down('ControlLeft') || inp.down('ControlRight');
    const wantSprint = (inp.down('ShiftLeft') || inp.down('ShiftRight'))
      && !this.crouching && len > 0 && !this._exhausted;
    this.sprinting = wantSprint && this.stamina > 0;

    const target = this.crouching ? PLAYER.speedCrouch
      : this.sprinting ? PLAYER.speedSprint : PLAYER.speedWalk;

    // 카메라 yaw 기준 월드 방향
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = fx * cos - fz * sin;
    const wz = fx * sin + fz * cos;

    if (len > 0) {
      this.vel.x += (wx * target - this.vel.x) * Math.min(1, PLAYER.accel * dt);
      this.vel.z += (wz * target - this.vel.z) * Math.min(1, PLAYER.accel * dt);
    } else {
      const f = Math.max(0, 1 - PLAYER.friction * dt);
      this.vel.x *= f;
      this.vel.z *= f;
    }

    // 축별 이동 후 충돌 해소 → 벽을 따라 미끄러진다
    let nx = this.pos.x + this.vel.x * dt;
    let nz = this.pos.z + this.vel.z * dt;
    const r = this.collision.resolve(nx, nz, WORLD.playerRadius);
    if (r.hit) {
      // 벽에 박힌 방향 속도를 죽여서 진동 방지
      if (Math.abs(r.x - nx) > 1e-5) this.vel.x *= 0.2;
      if (Math.abs(r.z - nz) > 1e-5) this.vel.z *= 0.2;
    }
    this.pos.x = r.x;
    this.pos.z = r.z;
  }

  _stamina(dt) {
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - PLAYER.staminaDrain * dt);
      if (this.stamina <= 0) this._exhausted = true;
    } else {
      this.stamina = Math.min(PLAYER.maxStamina, this.stamina + PLAYER.staminaRegen * dt);
      if (this._exhausted && this.stamina >= PLAYER.staminaMinToSprint) this._exhausted = false;
    }
  }

  _footsteps(dt) {
    const sp = this.speed;
    if (sp < 0.4) { this._stepAccum = 0; return; }
    this._stepAccum += sp * dt;
    const stride = this.crouching ? 1.4 : this.sprinting ? 1.9 : 1.6;
    if (this._stepAccum >= stride) {
      this._stepAccum = 0;
      const n = 1 + ((Math.random() * 4) | 0);
      bus.emit(EV.SFX, {
        name: `footstep_${n}`,
        volume: this.crouching ? 0.25 : this.sprinting ? 0.75 : 0.5,
      });
      // 발소리는 좀비를 부른다
      const radius = this.crouching ? NOISE.walk * 0.4
        : this.sprinting ? NOISE.sprint : NOISE.walk;
      bus.emit(EV.NOISE, { x: this.pos.x, z: this.pos.z, radius, source: 'footstep' });
    }
  }

  _syncCamera(dt) {
    const targetEye = this.crouching ? WORLD.crouchHeight : WORLD.eyeHeight;
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, 9 * dt);

    // 헤드밥 — 걸을 때만
    let bob = 0;
    if (this.speed > 0.5) {
      this._bobPhase += dt * PLAYER.headBobSpeed * (this.sprinting ? 1.35 : 1);
      bob = Math.sin(this._bobPhase) * PLAYER.headBobAmount * (this.sprinting ? 1.5 : 1);
    } else {
      this._bobPhase = 0;
    }

    this.camera.position.set(this.pos.x, this.pos.y + this.eyeHeight + bob, this.pos.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }

  damage(amount) {
    if (!this.alive || this._invuln > 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this._invuln = PLAYER.invulnAfterHit;
    bus.emit(EV.SFX, { name: 'player_hurt', volume: 0.8 });
    bus.emit(EV.PLAYER_DAMAGED, { hp: this.hp, amount });
    if (this.hp <= 0) {
      this.alive = false;
      bus.emit(EV.PLAYER_DIED, {});
    }
  }

  heal(amount) {
    this.hp = Math.min(PLAYER.maxHp, this.hp + amount);
  }

  /** 좀비가 바라보는 방향 판정용 */
  getForward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }
}
