import * as THREE from 'three';
import { ZOMBIE, AI, KNOCK, CORPSE, ZOMBIE_STEP, STEALTH, ANIM } from '../config/balance.js';
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
    this._jitter = 1; this._screamTimer = 0; this.flinch = 0; this._flinchTotal = 0.5;
    this._noticeCd = 0;   // "눈치챘다" 소리 재사용 대기
    requestZombieModel((inst) => this._attachModel(inst));

    this.def = ZOMBIE.shambler;
    this._reset();
  }

  _attachModel({ root, mixer, actions, jitter, outfit }) {
    this.outfit = outfit;        // 'coat' 흰 가운 / 'scrub' 수술복 / null 원본 (검사용)
    this.group.remove(this.body, this.head);
    this.body.geometry.dispose();
    this.head.geometry.dispose();
    root.rotation.y = MODEL_YAW;
    this.group.add(root);
    this.model = root;
    // 모델은 비동기로 붙는다 — 이미 스폰된 뒤일 수 있으므로 높이 보정을 여기서도 건다
    root.position.y = this.def?.modelYOffset ?? 0;
    this.mixer = mixer;
    this.actions = actions;
    this._jitter = jitter ?? 1;
  }

  /** 상태 → 클립 종류 */
  _animKey() {
    if (this.state === 'DEAD') return 'death';
    if (this.stun > 0 || this.flinch > 0) return 'hit';
    if (this._screamTimer > 0) return 'scream';        // 발견 순간의 포효
    // 기어다니는 개체는 서는 동작이 없다 — 이동/정지/공격 전부 엎드린 클립을 쓴다.
    // **공격 판정을 ATTACK 보다 먼저 본다.** 선 자세 공격 클립을 쓰면 modelYOffset(-0.62)
    // 때문에 몸이 바닥 아래로 묻힌다 (tools/qa_motion.js 가 잡았다).
    if (this.def.crawler) {
      if (this.state === 'ATTACK') return 'crawl';     // 빠르게 돌려 달려드는 것처럼 (ANIM)
      return this._moveSpeed > 0.15 ? 'crawl' : 'crawlIdle';
    }
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
      // **지터는 clamp 안에서 곱한다.** 밖에서 곱하면 하한을 걸어 놓고 그 뒤에 0.92 를
      // 곱해 0.37 이 나온다 — 발이 끌리는 슬로모션이 된다 (tools/qa_motion.js 가 잡았다).
      next.timeScale = THREE.MathUtils.clamp(
        (this._moveSpeed / Math.max(ref, 0.1)) * this._jitter,
        ANIM.moveMinSpeed, ANIM.moveMaxSpeed);
    } else if (next && key === 'crawl') {
      // 포복체의 공격은 기는 동작을 빠르게 돌린 것이다 (엎드린 공격 클립이 없다)
      next.timeScale = (this.state === 'ATTACK' ? ANIM.crawlerAttackSpeed : 1) * this._jitter;
    } else if (next && key === 'hit') {
      // hit_01 은 2.6초짜리라 스턴(1.4초) 안에 절반만 나오고 잘린다.
      // 플린치 시간에 맞춰 압축해서 동작이 끝까지 보이게 한다.
      // 상한을 안 걸면 짧은 플린치(0.42초)에서 6배 속도가 나와 경련처럼 보인다.
      next.timeScale = Math.min(2.6, next.getClip().duration / Math.max(this._flinchTotal, 0.2));
    } else if (next && key === 'attack') {
      // 한 번 휘두르는 시간이 공격 쿨다운과 맞게 — 루프로 계속 휘두르면 우스워진다.
      // **다만 상한을 걸어야 한다.** 4.5초짜리 클립을 1.1초 쿨다운에 맞추면 4.5배속이 되어
      // 팔이 경련하는 것처럼 보인다 (tools/qa_motion.js 가 잡았다).
      // 상한에 걸리면 동작이 쿨다운보다 일찍 끝나지만, 그 편이 훨씬 자연스럽다.
      const fit = next.getClip().duration / this.def.attackCooldown;
      // 여기도 지터를 clamp 안에서 곱한다 — 밖에서 곱하면 상한 2.0 을 걸어 놓고 2.16 이 나온다
      next.timeScale = THREE.MathUtils.clamp(
        fit * this._jitter, ANIM.attackMinSpeed, ANIM.attackMaxSpeed);
    } else if (next && key === 'death') {
      // 원본이 3초라 그대로 두면 너무 느리게 쓰러져 답답하다
      next.timeScale = CORPSE.deathSpeed * this._jitter;
    } else if (next) {
      next.timeScale = this._jitter;
    }
    if (this._screamTimer > 0) this._screamTimer -= dt;
    if (this.flinch > 0) {
      this.flinch -= dt;
      // 충격으로 몸이 젖혀진다 — 애니메이션만으로는 타격감이 약하다.
      // 맞는 순간 최대로 젖혀지고 서서히 돌아온다.
      // sin(t*PI) 로 하면 중간에 최대가 되어 타격 순간에 반응이 없다.
      const t = Math.max(0, this.flinch / Math.max(this._flinchTotal, 0.01));
      const bend = Math.sin(t * Math.PI * 0.5) * KNOCK.bend;
      // 맞은 방향으로 젖힌다. 옆에서 맞으면 옆으로 비틀린다.
      this.group.rotation.x = -bend * (this._flinchZ ?? 1);
      this.group.rotation.z = bend * (this._flinchX ?? 0) * 0.8;
    } else if (this.state !== 'DEAD' && (this.group.rotation.x || this.group.rotation.z)) {
      this.group.rotation.x = 0;
      this.group.rotation.z = 0;
    }

    // 보이는 위치만 뒤로 밀린다 (좌표는 그대로 — 벽을 뚫거나 경로가 꼬이면 안 된다)
    if (this._knockT > 0) {
      this._knockT = Math.max(0, this._knockT - dt);
      const k = this._knockT / Math.max(this._knockTotal, 0.01);
      const amt = KNOCK.distance * k * k;
      this.group.position.x += this._knockX * amt;
      this.group.position.z += this._knockZ * amt;
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
    this.flinch = 0;
    this._knockT = 0; this._knockTotal = 0;
    this._knockX = 0; this._knockZ = 0;
    this._flinchX = 0; this._flinchZ = 1;
    this._settled = false; this._corpseY = 0;
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
    this._prevX = x; this._prevZ = z; this._moveSpeed = 0; this._screamTimer = 0;

    // 기어다니는 개체는 몸집이 작은 게 아니라 엎드린 것이다 — height 로 줄이면 미니어처가 된다.
    // 그래서 모델 배율은 따로 준다. (height 는 피격 판정·시야 높이에만 쓴다)
    this.group.scale.setScalar(this.def.modelScale ?? this.def.height / 1.75);
    // 변환 때 루트의 수직 이동을 지워서, 엎드린 클립을 쓰면 골반이 선 자세 높이에 남아 뜬다.
    // 그만큼 모델을 내려서 바닥에 붙인다.
    if (this.model) this.model.position.y = this.def.modelYOffset ?? 0;
    this.group.visible = true;
    this._syncMesh();
  }

  /**
   * 지금 자세에서 **가장 낮은 뼈**를 찾아, 그것이 바닥에 닿도록 내릴 양을 돌려준다.
   * 자세를 가리지 않으므로 어떤 사망 클립이 뽑혀도 통한다.
   * (Box3.setFromObject 는 스킨 메시의 실제 자세를 반영하지 않아 못 쓴다)
   */
  _groundOffset() {
    if (!this.model) return 0;
    this.group.updateMatrixWorld(true);
    let lowest = Infinity;
    this.model.traverse((o) => {
      if (!o.isBone) return;
      o.getWorldPosition(_tmp);
      if (_tmp.y < lowest) lowest = _tmp.y;
    });
    if (!Number.isFinite(lowest)) return 0;
    // 뼈는 살 안쪽에 있으므로 조금 띄워야 몸이 바닥에 파묻히지 않는다
    return this.group.position.y - lowest + CORPSE.restHeight;
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

    // 경계 상태로 **처음** 들어가는 순간에만 소리를 낸다.
    // 이게 스텔스의 유일한 경고다 — "들켰다"가 아니라 "무언가 눈치챘다".
    // 이 소리를 듣고 멈추거나 앉을 기회를 주는 것이 이 장치의 전부다.
    const wasCalm = this.state === 'WANDER' || this.state === 'SEARCH';
    if (wasCalm && this._noticeCd <= 0) {
      this._noticeCd = STEALTH.noticeCooldown;
      bus.emit(EV.SFX, { name: 'zombie_notice', x: this.pos.x, z: this.pos.z, volume: 0.7 });
    }

    this.target.x = x; this.target.z = z;
    this.state = 'ALERT';
    this.searchTimer = AI.searchTime;
  }

  /**
   * @param from 때린 쪽의 위치 {x,z}. 주면 그 방향으로 밀리고 젖혀진다 —
   *   어디서 맞았든 똑같이 뒤로 젖혀지면 타격이 "닿았다"는 느낌이 안 난다.
   */
  hit(damage, stun = 0, headshot = false, from = null) {
    if (!this.active || this.state === 'DEAD') return;
    this.hp -= damage;
    this.stun = Math.max(this.stun, stun / (this.def.stunResist || 1));
    if (headshot) this.stun += 0.15;
    // 플린치는 연출 전용 — AI 를 멈추지 않는다. 스턴이 0인 총알도 움찔하게 만든다.
    this._flinchTotal = Math.max(0.42, this.stun);
    this.flinch = this._flinchTotal;

    // 넉백·젖힘 방향. 위치는 건드리지 않고 **보이는 것만** 민다 —
    // 실제 좌표를 밀면 벽을 뚫거나 경로가 꼬인다.
    let kx = 0, kz = 1;
    if (from) {
      kx = this.pos.x - from.x; kz = this.pos.z - from.z;
      const L = Math.hypot(kx, kz) || 1;
      kx /= L; kz /= L;
    }
    this._knockX = kx; this._knockZ = kz;
    this._knockT = KNOCK.duration * (headshot ? 1.25 : 1)
      * (1 + Math.min(1, stun)) / (this.def.stunResist || 1);
    this._knockTotal = this._knockT;
    // 맞은 방향을 좀비 기준으로 분해한다 — 앞뒤 성분은 젖힘, 좌우 성분은 비틀림.
    // 전진 방향은 (-sin, -cos) 이고(파일 상단 MODEL_YAW 주석), 오른쪽은 그것과 직교하는
    // (cos, -sin) 이다. 회전행렬을 그대로 쓰면 축이 어긋나 옆에서 맞아도 뒤로 젖혀진다.
    const sf = Math.sin(this.facing), cf = Math.cos(this.facing);
    this._flinchZ = kx * -sf + kz * -cf;   // +면 앞으로 밀림 = 뒤에서 맞았다
    this._flinchX = kx * cf + kz * -sf;    // +면 오른쪽으로 밀림

    // 피격음 — 둔기(스턴 큼)는 뼈 소리, 총알은 살점 소리, 헤드샷은 따로
    const impact = headshot ? 'hit_headshot'
      : stun >= 0.8 ? `hit_blunt_${1 + ((Math.random() * 2) | 0)}`
        : `hit_flesh_${1 + ((Math.random() * 2) | 0)}`;
    bus.emit(EV.SFX, { name: impact, x: this.pos.x, z: this.pos.z, volume: 0.95 });
    // 맞은 자리에서 피가 튄다. 머리를 맞았으면 더 높은 곳에서, 더 많이.
    bus.emit(EV.ZOMBIE_HIT, {
      x: this.pos.x,
      y: this.def.height * (headshot ? 0.86 : 0.62),
      z: this.pos.z,
      nx: kx, nz: kz,
      power: headshot ? 1.8 : 1,
    });

    if (this.hp <= 0) {
      this.state = 'DEAD';
      this.deathTimer = CORPSE.linger;
      // 바닥 고정 시점을 **클립 길이에서 구한다.** 고정값(예전 1.6초)을 쓰면 3초짜리
      // 사망 클립이 아직 움직이는 중에 위치가 잠겨서 뼈가 바닥을 뚫고 내려갔다.
      const dClip = this.actions?.death?.getClip?.().duration ?? 1.5;
      this._settleAt = dClip / (CORPSE.deathSpeed * this._jitter) + CORPSE.settleMargin;
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
      const fallT = CORPSE.linger - this.deathTimer;          // 쓰러지기 시작한 뒤 지난 시간
      if (!this.model) {
        // 캡슐 폴백 — 손으로 눕힌다. 모델이 있으면 death 클립이 대신한다
        this.group.rotation.x = Math.min(Math.PI / 2, fallT * 2.2);
        this.group.position.y = -Math.min(0.5, fallT * 0.6);
      }
      // 자세를 먼저 갱신하고 나서 높이를 잰다 — 순서가 반대면 한 프레임 늦은 자세로 재게 된다
      this._updateAnim(dt);

      // 변환할 때 루트의 수직 이동을 지웠기 때문에(fbx_to_glb.py), 그냥 두면
      // 골반이 선 자세 높이에 남아 **시체가 공중에 뜬다.**
      // 예전에는 settleAt(1.6초) **뒤에 한 번만** 쟀다. 그래서 쓰러지는 1.6초 동안은
      // 공중에 뜬 채로 눕는 것이 그대로 보였다 — 죽는 순간이 제일 잘 보이는데 거기가 틀렸다.
      // 자세가 매 프레임 바뀌므로 높이도 매 프레임 다시 재야 한다.
      if (!this._settled) {
        this.group.position.y = this._groundOffset();
        if (fallT > (this._settleAt ?? 1.6)) {
          this._settled = true;                 // 동작이 끝났다. 고정하고 뼈 순회를 멈춘다
          this._corpseY = this.group.position.y;
        }
      } else {
        this.group.position.y = this._corpseY;
      }

      // 사라질 때는 바닥으로 가라앉는다. 그냥 없어지면 "게임이구나" 소리가 절로 난다.
      if (this.deathTimer < CORPSE.sink) {
        const k = 1 - this.deathTimer / CORPSE.sink;
        this.group.position.y = (this._corpseY ?? this.group.position.y) - k * CORPSE.sinkDepth;
      }
      if (this.deathTimer <= 0) this.despawn();
      return;
    }

    this.groanTimer -= dt;
    if (this.groanTimer <= 0) {
      this.groanTimer = 5 + Math.random() * 9;
      const gn = 1 + ((Math.random() * 3) | 0);
      bus.emit(EV.SFX, { name: `zombie_groan_${gn}`, x: this.pos.x, z: this.pos.z, volume: 0.55 });
    }

    if (this._noticeCd > 0) this._noticeCd -= dt;
    if (this.stun > 0) { this.stun -= dt; this._syncMesh(dt); this._updateAnim(dt); return; }

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
      case 'ATTACK': this._attack(dt, player, dist, collision); break;
    }

    this._syncMesh(dt);
    this._updateAnim(dt);
    this._footsteps(dt, dist);
  }

  /**
   * 발소리. 손전등이 닿지 않는 곳에서 무언가 걸어오는 소리가 나는 것이
   * 이 게임에서 가장 값싼 공포다. 3D 오디오라 방향과 거리가 그대로 들린다.
   */
  _footsteps(dt, dist) {
    if (this.state === 'DEAD' || this._moveSpeed < 0.15) return;
    // 멀리 있는 개체까지 다 내면 14마리분이 겹쳐서 뭉갠다 — 정보가 오히려 사라진다
    if (dist > ZOMBIE_STEP.maxDistance) { this._stepAccum = 0; return; }

    this._stepAccum = (this._stepAccum ?? 0) + this._moveSpeed * dt;
    const stride = ZOMBIE_STEP.stride * (this.def.crawler ? 0.7 : 1);
    if (this._stepAccum < stride) return;
    this._stepAccum = 0;

    const n = 1 + ((Math.random() * 4) | 0);
    bus.emit(EV.SFX, {
      name: `footstep_concrete_${n}`,
      x: this.pos.x, z: this.pos.z,
      volume: ZOMBIE_STEP.volume,
      // 개체마다 조금씩 다르게 — 같은 속도로 밟으면 한 마리가 여러 번 밟는 것처럼 들린다
      rate: (this.def.crawler ? ZOMBIE_STEP.crawlerRate : ZOMBIE_STEP.rate)
        * (0.9 + Math.random() * 0.2),
    });
  }

  _startChase() {
    if (this.state !== 'CHASE') {
      bus.emit(EV.SFX, { name: 'zombie_alert', x: this.pos.x, z: this.pos.z, volume: 0.9 });
    }
    if (this.state !== 'CHASE') {
      this._screamTimer = 0.9;
      // 발견의 순간이 조용하면 공포가 안 산다. 절반은 비명, 절반은 놀란 숨소리.
      const nm = Math.random() < 0.55 ? `zombie_scream_${1 + ((Math.random() * 2) | 0)}` : 'zombie_notice';
      bus.emit(EV.SFX, { name: nm, x: this.pos.x, z: this.pos.z, volume: 0.95 });
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

    // 사거리에 들어와도 바로 때리지 않는다 — 팔을 드는 시간(attackWindup)이 있어야
    // 맞는 쪽에 뒤로 뺄 기회가 생긴다. 없으면 "닿는 순간 깎였다"로만 느껴진다.
    if (dist <= this.def.attackRange) {
      this.state = 'ATTACK';
      this.attackTimer = this.def.attackWindup ?? 0;
      return;
    }

    // 벽에 껴서 영원히 접근 못 하는 개체를 회수한다
    if (dist < this.bestDist - 0.4) { this.bestDist = dist; this.stuckTimer = 0; }
    else { this.stuckTimer += dt; if (this.stuckTimer > AI.stuckTimeout) { this.despawn(); return; } }

    this._goTo(dt, this.target.x, this.target.z, collision, zombies, this.def.speedChase);
  }

  _attack(dt, player, dist, collision) {
    this.attackTimer -= dt;
    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
    this.facing = Math.atan2(-dx, -dz);

    if (dist > this.def.attackRange * 1.35) { this.state = 'CHASE'; return; }

    // 벽 너머로 때리지 못하게 한다. 거리만 보면 문틈·모서리를 사이에 두고도 맞는다.
    if (collision?.segmentBlocked(this.pos.x, this.pos.z, player.pos.x, player.pos.z)) {
      this.state = 'CHASE';
      return;
    }

    if (this.attackTimer <= 0) {
      this.attackTimer = this.def.attackCooldown;
      player.damage(this.def.damage, this.pos);
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

  /**
   * @param dt 0 이면 즉시 맞춘다 (스폰 직후 — 스폰 방향으로 도는 모습이 보이면 안 된다)
   */
  _syncMesh(dt = 0) {
    this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
    if (this.state !== 'DEAD') {
      // 방향을 즉시 덮어쓰면 회피·밀어내기로 목표 방향이 바뀔 때마다 홱 돈다 —
      // 살아 있는 것이 아니라 포탑처럼 보인다. 초당 회전량을 제한해서 몸이 따라오게 한다.
      if (dt > 0) {
        const rate = (this.def.turnRate ?? AI.turnRate) * dt;
        // 최단 경로로 돈다. 그냥 빼면 ±π 를 넘길 때 반대로 한 바퀴 돈다
        let d = this.facing - this.group.rotation.y;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.group.rotation.y += THREE.MathUtils.clamp(d, -rate, rate);
      } else {
        this.group.rotation.y = this.facing;
      }
      if (!this.model) {
        // 캡슐 폴백의 걷는 느낌. 진짜 애니메이션이 있으면 흔들면 안 된다
        const moving = this.state === 'CHASE' || this.state === 'ALERT' || this.state === 'WANDER';
        this.group.rotation.z = moving ? Math.sin(performance.now() * 0.006 + this.pos.x) * 0.07 : 0;
      }
    }
  }
}
