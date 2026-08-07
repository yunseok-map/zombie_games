import * as THREE from 'three';
import { WORLD, PLAYER, NOISE, INJURY, SHAKE, ATTACK, GRAB, AUDIO } from '../config/balance.js';
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

    // ── 물림 ──
    // 붙잡은 좀비. null 이면 안 물린 상태다. 놓아주는 판단은 **전부 여기서** 한다 —
    // 뿌리치기·시간 초과·좀비의 죽음을 한 곳에서 봐야 어긋날 여지가 없다.
    this.grabbedBy = null;
    this.struggle = 0;         // 0~1. HUD 가 읽는다
    this._grabT = 0;
    this._grabCd = 0;          // 뿌리친 뒤 쿨다운 — 연속으로 물리면 억울하다

    // 맞은 쪽 반대로 카메라가 밀린다. 흔들림(_trauma)과 달리 **방향이 있다.**
    this._kick = 0;
    this._kickX = 0; this._kickZ = 0;

    // 화면 흔들림 — trauma 를 쌓고 제곱해서 쓴다. 약할 때는 티가 안 나고 셀 때 확 온다.
    // 흔들림이 없으면 무엇을 때리든 화면이 가만히 있어서 전부 물렁하게 느껴진다.
    this._trauma = 0;
    this._shakeT = 0;
    // 총을 쏘면 조준점이 **실제로 위로 튄다.** 흔들림만 있으면 반동이 연출이지
    // 대가가 아니다 — 조준을 다시 잡아야 비로소 연사에 값이 생긴다.
    this._gunKick = 0; this._gunKickYaw = 0;
    bus.on(EV.WEAPON_FIRED, ({ weapon }) => {
      if (weapon?.type !== 'gun') return;
      this.addShake(SHAKE.gunshot);
      this._gunKick += SHAKE.gunKickPitch;
      // 좌우는 매번 다른 쪽으로. 같은 쪽이면 기계가 튀는 것처럼 보인다
      this._gunKickYaw += (Math.random() - 0.5) * 2 * SHAKE.gunKickYaw;
    });
    bus.on(EV.MELEE_HIT, () => this.addShake(SHAKE.melee));
    bus.on(EV.MELEE_CLANG, () => this.addShake(SHAKE.meleeWall));
    // 헤드샷이 **닿았을 때만** 추가로 흔들린다. 빗나간 총알에는 안 온다 —
    // 이 한 줄이 "머리를 맞혔다"를 몸으로 알려주는 유일한 통로다.
    bus.on(EV.ZOMBIE_HIT, ({ headshot }) => {
      if (headshot) this.addShake(SHAKE.headshot);
    });
  }

  addShake(v) { this._trauma = Math.min(1, this._trauma + v); }

  /**
   * 지금 내가 내는 소리가 닿는 거리(m). 발소리와 HUD 노출도가 **같은 값**을 봐야 한다 —
   * 따로 계산하면 화면에 보이는 것과 실제로 좀비가 듣는 것이 어긋난다.
   * 서 있기만 해도 이 값이다. 실제 소리는 걸을 때만 난다(_footsteps).
   */
  get noiseRadius() {
    if (this.crouching) return NOISE.walk * NOISE.crouchMul;
    return this.sprinting ? NOISE.sprint : NOISE.walk;
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
    // 물린 채로 죽으면 다음 판이 물린 상태로 시작한다 — 움직이지도 못한다
    this.grabbedBy = null;
    this.struggle = 0;
    this._grabT = 0;
    this._grabCd = 0;
    // 연출 상태도 되돌린다 — 달리다 죽으면 넓어진 시야각·기운 몸이 다음 판 시작에 남는다
    this._kick = 0;
    this._gunKick = 0; this._gunKickYaw = 0;
    this._strafe = 0;
    this._roll = 0;
    this.camera.fov = PLAYER.fov;
    this.camera.updateProjectionMatrix();
    this._syncCamera(0);
  }

  get speed() { return Math.hypot(this.vel.x, this.vel.z); }

  /** 부상 단계 — 0 멀쩡 · 1 절뚝임 · 2 심각 */
  get injury() {
    const r = this.hp / PLAYER.maxHp;
    return r < INJURY.crippledBelow ? 2 : r < INJURY.limpBelow ? 1 : 0;
  }
  get moveMul() { return INJURY.moveMul[this.injury]; }
  /** 근접 공격 배수 — WeaponSystem 이 본다 */
  get meleeMul() { return INJURY.meleeMul[this.injury]; }
  get swayMul() { return INJURY.swayMul[this.injury]; }

  update(dt) {
    if (!this.alive) return;
    if (this._grabCd > 0) this._grabCd -= dt;
    this._look();
    if (this.grabbedBy) this._grabbed(dt);
    else this._move(dt);
    this._stamina(dt);
    this._footsteps(dt);
    if (this._invuln > 0) this._invuln -= dt;
    this._syncCamera(dt);
  }

  /** 지금 물릴 수 있는가 — Zombie 가 타격이 **닿은 순간에만** 묻는다 */
  canBeGrabbed() {
    return this.alive && !this.grabbedBy && this._grabCd <= 0
      && this.hp / PLAYER.maxHp > GRAB.minHpRatio;
  }

  beginGrab(z) {
    this.grabbedBy = z;
    this.struggle = 0;
    this._grabT = 0;
    this.vel.set(0, 0, 0);
    this.addShake(SHAKE.hurt);
    bus.emit(EV.SFX, { name: 'zombie_attack', x: z.pos.x, z: z.pos.z, volume: 1 });
  }

  /**
   * 물려 있는 동안.
   * - 못 움직인다. 시야는 좀비 쪽으로 끌리되 완전히 뺏지는 않는다(다 뺏으면 멀미난다).
   * - Space 연타로 게이지를 채운다. **가만히 있으면 절대 안 풀린다** (감쇠가 더 크다).
   * - 시간이 다 가면 강제로 풀리고 큰 피해를 받는다 — 무한히 갇히면 게임이 아니다.
   */
  _grabbed(dt) {
    const z = this.grabbedBy;
    // 좀비가 죽었거나 반납됐거나 **총에 맞아 물기를 놓쳤으면** 즉시 풀린다.
    // 이 검사가 없으면 물고 있던 좀비를 쏴 죽였을 때 영원히 갇힌다.
    if (!z.active || z.state !== 'GRAB') { this._endGrab(true); return; }

    this._grabT += dt;
    // 남은 시간을 공개 필드로 둔다 — HUD 가 private `_grabT` 를 읽으면 안 된다.
    // 못 뿌리치면 큰 피해를 받는데(GRAB.breakDamage) 얼마나 남았는지가 화면에 없었다.
    this.grabLeft = Math.max(0, 1 - this._grabT / GRAB.maxSeconds);
    this.vel.set(0, 0, 0);

    // 시야가 끌린다 — 얼굴을 보게 만드는 것이 이 장치의 전부다
    const want = Math.atan2(-(z.pos.x - this.pos.x), -(z.pos.z - this.pos.z));
    let d = want - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    // 완전히 정면으로 고정하지 않는다. lookFree 만큼은 남겨 둔다
    const pull = Math.max(0, Math.abs(d) - GRAB.lookFree) * Math.sign(d);
    this.yaw += pull * Math.min(1, GRAB.lookLerp * dt);

    // 지속 피해 — **무적시간을 무시한다.** 물린 채로 안 깎이면 위협이 아니다
    this.hp = Math.max(0, this.hp - GRAB.dps * dt);
    if (this.hp <= 0) { this._endGrab(false); this._die(); return; }

    // 뿌리치기
    if (this.input.justPressed('Space')) {
      this.struggle += GRAB.mashGain;
      this.addShake(SHAKE.melee * 0.5);
    }
    this.struggle = Math.max(0, this.struggle - GRAB.mashDecay * dt);

    if (this.struggle >= 1) {
      z.onGrabBroken?.();
      this._endGrab(true);
      bus.emit(EV.SFX, { name: 'zombie_alert', x: z.pos.x, z: z.pos.z, volume: 0.8 });
      return;
    }
    if (this._grabT >= GRAB.maxSeconds) {
      // 시간 초과 — 큰 피해를 주고 놓아준다. 억울하지만 무한 루프보다는 낫다
      this.hp = Math.max(0, this.hp - GRAB.breakDamage);
      this.addShake(SHAKE.hurt);
      this._endGrab(false);
      if (this.hp <= 0) this._die();
    }
  }

  _endGrab(broke) {
    const z = this.grabbedBy;
    this.grabbedBy = null;
    this.struggle = 0;
    this._grabCd = GRAB.cooldown;
    bus.emit(EV.GRAB_END, { broke });
    if (z && broke) this.addShake(SHAKE.melee);
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
    // 심하게 다치면 달릴 수 없다 — 도망이라는 선택지 자체가 사라진다
    const canSprint = this.hp / PLAYER.maxHp >= INJURY.sprintLockBelow;
    const wantSprint = (inp.down('ShiftLeft') || inp.down('ShiftRight'))
      && !this.crouching && len > 0 && !this._exhausted && canSprint;
    this.sprinting = wantSprint && this.stamina > 0;

    const target = (this.crouching ? PLAYER.speedCrouch
      : this.sprinting ? PLAYER.speedSprint : PLAYER.speedWalk) * this.moveMul;

    // 카메라 yaw 기준 월드 방향.
    // 기준은 getForward() 의 (-sin, -cos) 다 — three.js 카메라는 로컬 -Z 를 본다.
    // 회전 부호를 반대로 쓰면 yaw=0 에서만 맞고 yaw=π 에서 전후·좌우가 통째로 뒤집힌다.
    //   전진(fz=-1) → (-sin, -cos) = getForward()
    //   우측(fx=+1) → ( cos, -sin) = forward 를 -90° 회전
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = fx * cos + fz * sin;
    const wz = -fx * sin + fz * cos;
    // 몸 기준 좌우 성분. 카메라를 기울이는 데 쓴다 (월드 좌표로는 어느 쪽이 '옆'인지 모른다)
    this._strafe = fx;

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
      // 밟고 있는 바닥 재질에 따라 소리가 바뀐다 (StageLoader 가 넣어준다)
      const surf = this.surfaceAt?.(this.pos.x, this.pos.z) ?? 'concrete';
      // 변형 개수는 좀비 발소리와 **같은 표**를 읽는다 (balance.js AUDIO)
      const n = 1 + ((Math.random() * (AUDIO.footstepVariants[surf] ?? 4)) | 0);
      bus.emit(EV.SFX, {
        name: `footstep_${surf}_${n}`,
        volume: this.crouching ? 0.25 : this.sprinting ? 0.8 : 0.52,
        // 달릴 때는 체중이 실려 낮게, 앉으면 가볍게 — 같은 파일도 다르게 들린다
        rate: (this.sprinting ? 0.88 : this.crouching ? 1.1 : 1.0) * (0.95 + Math.random() * 0.1),
      });
      // 발소리는 좀비를 부른다
      const radius = this.noiseRadius;
      bus.emit(EV.NOISE, { x: this.pos.x, z: this.pos.z, radius, source: 'footstep' });
    }
  }

  _syncCamera(dt) {
    const targetEye = this.crouching ? WORLD.crouchHeight : WORLD.eyeHeight;
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, 9 * dt);

    // 헤드밥 — 걸을 때만
    let bob = 0, sway = 0, roll = 0;
    const inj = this.injury;
    if (this.speed > 0.5) {
      this._bobPhase += dt * PLAYER.headBobSpeed * (this.sprinting ? 1.35 : 1);
      const sn = Math.sin(this._bobPhase);
      const amp = PLAYER.headBobAmount * (this.sprinting ? 1.5 : 1);
      bob = sn * amp;
      // 가로는 절반 주기다 — 한 걸음마다 위아래 두 번, 좌우 한 번. 이래야 8자를 그린다.
      // 위아래로만 흔들면 사람이 걷는 게 아니라 기계가 오르내리는 것처럼 보인다.
      sway = Math.sin(this._bobPhase * 0.5) * amp * PLAYER.headBobSide;
      if (inj > 0) {
        // 성한 다리에선 평소대로, 다친 다리에선 훅 꺼진다 → 절뚝이는 리듬
        if (sn < 0) bob *= INJURY.limpDip;
        roll += Math.sin(this._bobPhase * 0.5) * INJURY.limpRoll * inj;
      }
    } else {
      this._bobPhase = 0;
    }

    // 옆으로 갈 때 몸이 기운다. 입력이 아니라 실제 이동을 따라가야 벽에 막혔을 때 안 기운다
    const wantRoll = roll - (this._strafe ?? 0) * PLAYER.strafeRoll;
    this._roll = (this._roll ?? 0) + (wantRoll - (this._roll ?? 0)) * Math.min(1, PLAYER.rollLerp * dt);

    // 시야각 — 달릴 때 넓어진다. 이 한 줄이 속도감의 대부분이다
    const wantFov = this.sprinting ? PLAYER.fovSprint : PLAYER.fov;
    if (Math.abs(this.camera.fov - wantFov) > 0.01) {
      this.camera.fov += (wantFov - this.camera.fov) * Math.min(1, PLAYER.fovLerp * dt);
      this.camera.updateProjectionMatrix();
    }

    // ── 화면 흔들림 ──
    this._trauma = Math.max(0, this._trauma - SHAKE.decay * dt);
    this._shakeT += dt;
    let shX = 0, shY = 0, shPitch = 0, shRoll = 0;
    if (this._trauma > 0.001) {
      const tr = this._trauma * this._trauma;   // 제곱 — 약하면 티가 안 나고 세면 확 온다
      const s = this._shakeT * SHAKE.freq;
      // 주파수를 여러 개 겹친다. 단일 sin 은 규칙적이라 기계가 진동하는 것처럼 보인다
      const n1 = Math.sin(s) + Math.sin(s * 2.31 + 1.7) * 0.5;
      const n2 = Math.sin(s * 1.63 + 0.9) + Math.sin(s * 3.07 + 2.4) * 0.5;
      const n3 = Math.sin(s * 1.27 + 2.8);
      shX = n1 * SHAKE.maxPos * tr;
      shY = n2 * SHAKE.maxPos * tr;
      shPitch = n2 * SHAKE.maxAngle * tr;
      shRoll = n3 * SHAKE.maxAngle * tr;
    }

    // ── 방향 있는 충격 ──
    // 맞은 쪽 반대로 몸이 밀리고 고개가 젖혀진다. 제곱해서 쓰면 초반만 확 오고 금방 잦아든다.
    if (this._kick > 0.0001) this._kick = Math.max(0, this._kick - ATTACK.camKickDecay * dt);
    const kk = this._kick * this._kick;

    // ── 총기 반동 ──
    // **조준점이 실제로 움직인다.** 되돌아오는 것이 핵심이다 — 안 돌아오면
    // 연사할수록 천장을 보게 된다. 지수 감쇠라 프레임률과 무관하다.
    if (this._gunKick > 1e-5 || this._gunKickYaw) {
      const rec = Math.exp(-SHAKE.gunKickRecover * dt);
      this._gunKick *= rec;
      this._gunKickYaw *= rec;
      if (this._gunKick < 1e-5) { this._gunKick = 0; this._gunKickYaw = 0; }
    }

    // 카메라의 좌우 흔들림은 몸 기준이라 yaw 로 월드에 돌려서 더한다
    const sn2 = Math.sin(this.yaw), cs = Math.cos(this.yaw);
    const lateral = sway + shX;
    this.camera.position.set(
      this.pos.x + lateral * cs + this._kickX * ATTACK.camKick * kk,
      this.pos.y + this.eyeHeight + bob + shY,
      this.pos.z - lateral * sn2 + this._kickZ * ATTACK.camKick * kk,
    );
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw + this._gunKickYaw;
    this.camera.rotation.x = this.pitch + shPitch + ATTACK.camKickPitch * kk + this._gunKick;
    this.camera.rotation.z = this._roll + shRoll;   // 옆걸음 + 부상 + 흔들림
  }

  /**
   * @param from 때린 쪽 위치 {x,z}. 주면 **어느 쪽에서 맞았는지** 화면에 표시된다.
   *   어둠 속에서 뒤에서 맞으면 방향을 모른 채 죽는다 — 그건 공포가 아니라 억울함이다.
   */
  damage(amount, from = null) {
    if (!this.alive || this._invuln > 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this._invuln = PLAYER.invulnAfterHit;
    this.addShake(SHAKE.hurt);
    if (from) this.addKick(from);
    bus.emit(EV.SFX, { name: 'player_hurt', volume: 0.8 });
    // 화면 기준 각도로 바꿔서 넘긴다 — HUD 는 월드 좌표를 모른다.
    // 0 = 정면, +는 오른쪽. 몸이 돌면 표시도 같이 돌아야 한다
    // 각도 빼기로 구하면 부호를 틀리기 쉽다. 이 파일 위쪽(_move)에 적힌 기저를 그대로 쓴다 —
    //   전방 (-sin, -cos) · 우측 (cos, -sin)
    let dir = null;
    if (from) {
      const dx = from.x - this.pos.x, dz = from.z - this.pos.z;
      const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
      const f = dx * -s + dz * -c;   // 앞쪽 성분
      const r = dx * c + dz * -s;    // 오른쪽 성분
      dir = Math.atan2(r, f);        // 0 = 정면, + = 오른쪽
    }
    bus.emit(EV.PLAYER_DAMAGED, { hp: this.hp, amount, dir });
    if (this.hp <= 0) this._die();
  }

  /** 죽음 처리는 한 곳에만 둔다 — 물림 시간 초과로도 죽을 수 있다 */
  _die() {
    if (!this.alive) return;
    this.alive = false;
    this.grabbedBy = null;      // 죽은 채로 물려 있으면 다음 판까지 따라간다
    this.struggle = 0;
    bus.emit(EV.PLAYER_DIED, {});
  }

  /**
   * 맞은 쪽 **반대로** 몸이 밀린다. `_trauma`(흔들림)와 달리 **방향이 있다** —
   * 흔들리기만 하면 어디서 맞았는지 몸으로 안 온다. 붉은 물듦은 머리로 읽는 표시고
   * 이건 몸으로 읽는 표시다.
   */
  addKick(from) {
    const dx = this.pos.x - from.x, dz = this.pos.z - from.z;
    const d = Math.hypot(dx, dz) || 1;
    this._kickX = dx / d; this._kickZ = dz / d;
    this._kick = 1;
  }

  heal(amount) {
    this.hp = Math.min(PLAYER.maxHp, this.hp + amount);
  }

  /** 좀비가 바라보는 방향 판정용 */
  getForward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }
}
