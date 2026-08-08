import * as THREE from 'three';
import { ZOMBIE, AI, KNOCK, CORPSE, ZOMBIE_STEP, STEALTH, DEATH, AUDIO } from '../config/balance.js';
import { bus, EV } from '../core/EventBus.js';
import { requestZombieModel } from './ZombieModel.js';
import * as ZombieAnim from './ZombieAnim.js';
import * as ZombieCombat from './ZombieCombat.js';

/**
 * 모델 방향 보정.
 * facing 은 플레이어와 같은 규약을 쓴다 — 전진 방향이 (-sin, -cos), 즉 로컬 -Z.
 * (Zombie.js 239행: `const fx = -Math.sin(this.facing)`)
 * Mixamo 캐릭터는 +Z 를 보므로 180° 돌려야 진행 방향을 바라본다.
 * 이걸 0 으로 두면 좀비가 뒷걸음질로 다가온다.
 */
const MODEL_YAW = Math.PI;


/**
 * 상체 반동을 걸 뼈. Mixamo 리그라 4개 GLB 전부에 같은 이름으로 존재한다
 * (shambler 63관절 · 나머지 65관절, 접두어 `mixamorig:` 까지 동일).
 * 순서는 KNOCK.boneWeights 의 키와 짝을 이룬다.
 */
const PUNCH_BONES = ['Spine', 'Spine1', 'Spine2', 'Neck', 'Head'];

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
    this._bones = [];     // 모델이 붙기 전에도 _groundOffset 이 안전하게 돌아야 한다
    requestZombieModel((inst) => this._attachModel(inst));

    this.def = ZOMBIE.shambler;
    this._reset();
  }

  _attachModel({ root, mixer, actions, jitter, outfit, phase, sizeMul, roll }) {
    this.outfit = outfit;        // 'coat' 흰 가운 / 'scrub' 수술복 / null 원본 (검사용)
    this._roll = roll;           // 피격·사망 클립을 그때그때 새로 뽑는다 (ZombieModel.roll)
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
    this._phase = phase ?? Math.random();
    this._sizeMul = sizeMul ?? 1;
    // 모델이 늦게 붙을 수 있으므로 여기서도 키를 적용한다 (spawn 이 이미 지나갔을 수 있다)
    this.group.scale.setScalar((this.def?.modelScale ?? (this.def?.height ?? 1.75) / 1.75) * this._sizeMul);

    // 상체 반동용 뼈를 **여기서 한 번만** 찾는다.
    // getObjectByName 은 트리를 통째로 훑으므로 매 프레임 부르면 안 된다.
    // 못 찾으면 배열이 비고, 그 경우 예전처럼 group 회전으로 떨어진다 (캡슐 폴백 포함).
    this._punchBones = PUNCH_BONES
      .map((n) => root.getObjectByName(`mixamorig:${n}`))
      .filter(Boolean);
    this._punchW = this._punchBones.map((b) =>
      KNOCK.boneWeights[b.name.replace('mixamorig:', '')] ?? 0);

    // 시체 접지가 쓸 뼈 목록도 여기서 한 번만 모은다 (_groundOffset 참조).
    // traverse 는 뼈가 아닌 노드까지 방문하고 매번 클로저를 새로 만든다 —
    // 쓰러지는 1.9초 동안 매 프레임 돌던 것이다.
    this._bones = [];
    root.traverse((o) => { if (o.isBone) this._bones.push(o); });
  }

  /** 상태 → 클립 종류 */
  _animKey() { return ZombieAnim._animKey(this); }

  _updateAnim(dt) { return ZombieAnim._updateAnim(this, dt); }

  /**
   * 상체 반동을 mixer 결과 **위에** 덧씌운다.
   *
   * 반드시 `mixer.update()` **뒤**여야 한다 — mixer 가 매 프레임 뼈 쿼터니언을
   * 통째로 덮어쓰므로, 그 뒤에 곱하면 누적되지 않고 플린치가 끝나면 저절로
   * 원래대로 돌아온다. 되돌리는 코드가 필요 없는 것이 이 방식의 요점이다.
   *
   * 히트스톱 분기 **밖**에 둔다: mixer.update(0) 도 뼈를 다시 쓰기 때문에,
   * 안에 두면 히트스톱 동안만 반동이 사라진다 — 하필 가장 잘 보이는 순간이다.
   */
  _punch() { return ZombieAnim._punch(this); }

  _reset() {
    this.hp = 0;
    this.stun = 0;
    this.loseTimer = 0;
    this.searchTimer = 0;
    this.stuckTimer = 0;
    this.bestDist = Infinity;
    this.target = { x: 0, z: 0 };
    this.wanderTimer = 0;
    this.deathTimer = 0;
    this.flinch = 0;
    this._bend = 0; this._flinchPower = 1;
    this._sinceHit = 99; this._hitRestart = false;
    this._knockT = 0; this._knockTotal = 0;
    this._knockX = 0; this._knockZ = 0;
    this._flinchX = 0; this._flinchZ = 1;
    this._settled = false; this._corpseY = 0;
    this.groanTimer = Math.random() * 6;
    // 스윙 시계 — 클립과 데미지가 같이 쓴다
    this._swingT = 0; this._swingLen = 1; this._swingContact = 0; this._swingHit = false;
    this._hitstop = 0;
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
    // 개체마다 키가 조금씩 다르다 — 4% 차이도 무리에서는 확실히 보인다.
    // (피격 판정은 def.height/radius 를 쓰므로 이 배율에 안 흔들린다)
    this.group.scale.setScalar((this.def.modelScale ?? this.def.height / 1.75) * (this._sizeMul ?? 1));
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
  _groundOffset() { return ZombieAnim._groundOffset(this); }

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
  hit(damage, stun = 0, headshot = false, from = null, kind = 'blunt') { return ZombieCombat.hit(this, damage, stun, headshot, from, kind); }
  /** 불에 타는 피해. 넉백·핏방울·피격음이 없다 (ZombieCombat.burn 주석 참고) */
  burn(damage) { return ZombieCombat.burn(this, damage); }

  update(dt, ctx) {
    if (!this.active) return;
    const { player, collision, detectionMul, zombies, surfaceAt } = ctx;

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
      // 몸이 바닥에 닿는 소리. 쓰러지는 1.8초 동안 소리가 하나도 없어서
      // 넘어가는 동작이 무성영화처럼 보였다. 둔기음을 낮게 돌리면 '털썩'이 된다.
      if (!this._thudDone && fallT > (this._settleAt ?? 1.6) * DEATH.thudAt) {
        this._thudDone = true;
        bus.emit(EV.SFX, {
          name: `hit_blunt_${1 + ((Math.random() * 2) | 0)}`,
          x: this.pos.x, z: this.pos.z,
          volume: DEATH.thudVolume, rate: DEATH.thudRate,
        });
      }

      if (!this._settled) {
        // 접지 높이를 **그대로 먹이면 안 된다.** 그러면 매 프레임 "가장 낮은 뼈"가
        // 바닥에 붙어서, 몸이 떨어지는 대신 그 팔다리를 축으로 공중에서 돈다
        // (한 발로 버티며 허리가 솟은 자세). 클립에 낙하 성분이 없기 때문이다.
        // 시간으로 가속해 내려보내고, 접지 높이를 **하한**으로만 쓴다.
        const ground = this._groundOffset();
        const k = Math.min(1, fallT / (this._settleAt ?? 1.6));
        this.group.position.y = Math.max(ground * (k ** CORPSE.fallEase), ground);
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
    this._distToPlayer = dist;      // 애니메이션 LOD 가 읽는다 (_updateAnim)
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
      case 'GRAB':   this._grab(dt, player); break;
    }

    this._syncMesh(dt);
    this._updateAnim(dt);
    this._footsteps(dt, dist, surfaceAt);
  }

  /**
   * 발소리. 손전등이 닿지 않는 곳에서 무언가 걸어오는 소리가 나는 것이
   * 이 게임에서 가장 값싼 공포다. 3D 오디오라 방향과 거리가 그대로 들린다.
   */
  _footsteps(dt, dist, surfaceAt) {
    if (this.state === 'DEAD' || this._moveSpeed < 0.15) return;
    // 멀리 있는 개체까지 다 내면 14마리분이 겹쳐서 뭉갠다 — 정보가 오히려 사라진다
    if (dist > ZOMBIE_STEP.maxDistance) { this._stepAccum = 0; return; }

    this._stepAccum = (this._stepAccum ?? 0) + this._moveSpeed * dt;
    const stride = ZOMBIE_STEP.stride * (this.def.crawler ? 0.7 : 1);
    if (this._stepAccum < stride) return;
    this._stepAccum = 0;

    // **밟고 있는 바닥 재질을 따른다.** 예전에는 다섯 구역 내내 콘크리트 고정이라,
    // 2·3층 타일 복도에서도 좀비 발소리만 콘크리트였고 젖은 바닥을 첨벙이며
    // 다가오는 소리는 게임에 아예 없었다. 플레이어는 이미 재질을 듣고 있었다.
    const surf = surfaceAt?.(this.pos.x, this.pos.z) ?? 'concrete';
    const n = 1 + ((Math.random() * (AUDIO.footstepVariants[surf] ?? 4)) | 0);
    bus.emit(EV.SFX, {
      name: `footstep_${surf}_${n}`,
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
      this._startSwing(this.def.attackWindup ?? 0);
      return;
    }

    // 벽에 껴서 영원히 접근 못 하는 개체를 회수한다
    if (dist < this.bestDist - 0.4) { this.bestDist = dist; this.stuckTimer = 0; }
    else { this.stuckTimer += dt; if (this.stuckTimer > AI.stuckTimeout) { this.despawn(); return; } }

    this._goTo(dt, this.target.x, this.target.z, collision, zombies, this.def.speedChase);
  }

  /**
   * 스윙 하나를 시작한다. **클립과 데미지가 같은 시계를 쓰게 만드는 곳이다.**
   *
   * 예전에는 클립이 제멋대로 루프하고 데미지는 별도 타이머로 들어갔다. 스윙마다
   * 되감지 않으니 두 번째 공격부터 위상이 어긋나서, 팔이 회수 중인데 체력이
   * 깎이거나 팔이 관통해도 아무 일이 없었다.
   *
   * @param delay 첫 스윙의 예비동작(attackWindup). 두 번째부터는 0 이다.
   */
  _startSwing(delay = 0) { return ZombieCombat._startSwing(this, delay); }

  _attack(dt, player, dist, collision) { return ZombieCombat._attack(this, dt, player, dist, collision); }

  /** 타격이 닿은 순간 — 여기서만 데미지·소리·물림이 일어난다 */
  _land(player) { return ZombieCombat._land(this, player); }

  /**
   * 물고 있는 동안. 놓아주는 판단은 **Player 쪽이 한다** —
   * 뿌리치기 입력과 시간 초과를 한 곳에서 보는 편이 어긋날 여지가 없다.
   */
  _grab(dt, player) { return ZombieCombat._grab(this, dt, player); }

  /** Player 가 뿌리쳤을 때 부른다 */
  onGrabBroken() { return ZombieCombat.onGrabBroken(this); }

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
