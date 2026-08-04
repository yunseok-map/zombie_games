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

    // 카메라 yaw 기준 월드 방향.
    // 기준은 getForward() 의 (-sin, -cos) 다 — three.js 카메라는 로컬 -Z 를 본다.
    // 회전 부호를 반대로 쓰면 yaw=0 에서만 맞고 yaw=π 에서 전후·좌우가 통째로 뒤집힌다.
    //   전진(fz=-1) → (-sin, -cos) = getForward()
    //   우측(fx=+1) → ( cos, -sin) = forward 를 -90° 회전
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = fx * cos + fz * sin;
    const wz = -fx * sin + fz * cos;

    // 지수 감쇠 — 프레임레이트가 흔들려도 감각이 같다 (dt 를 곱하기만 하면 60/144fps 가 달라진다)
    if (len > 0) {
      const k = 1 - Math.exp(-PLAYER.accel * dt);
      this.vel.x += (wx * target - this.vel.x) * k;
      this.vel.z += (wz * target - this.vel.z) * k;
    } else {
      const f = Math.exp(-PLAYER.friction * dt);
      this.vel.x *= f;
      this.vel.z *= f;
    }

    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    const r = this.collision.resolve(nx, nz, WORLD.playerRadius);

    if (r.hit) {
      // 밀려난 방향이 곧 벽 법선이다. 법선 성분만 지우고 접선 성분은 살린다.
      // 이렇게 해야 벽을 따라 정상 속도로 미끄러진다.
      // (예전처럼 속도를 통째로 0.2배 하면 벽에 스치는 내내 기어가게 된다)
      const px = r.x - nx, pz = r.z - nz;
      const plen = Math.hypot(px, pz);
      if (plen > 1e-6) {
        const nX = px / plen, nZ = pz / plen;
        const into = this.vel.x * nX + this.vel.z * nZ;
        if (into < 0) { this.vel.x -= nX * into; this.vel.z -= nZ * into; }
      }
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
