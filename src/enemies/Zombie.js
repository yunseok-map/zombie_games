import * as THREE from 'three';
import { ZOMBIE, AI, KNOCK, CORPSE, ZOMBIE_STEP, STEALTH, ANIM, ATTACK, GRAB, DEATH, AUDIO } from '../config/balance.js';
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

const _tmp = new THREE.Vector3();
// 뼈 반동용 임시값 — 매 프레임 만들면 그것만으로 GC 가 돈다 (좀비 14마리 x 뼈 5개)
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

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
  _animKey() {
    if (this.state === 'DEAD') return 'death';
    if (this.stun > 0 || this.flinch > 0) return 'hit';
    // 발견 순간의 포효. **기어다니는 개체는 제외한다** — 이것도 선 자세 클립이라
    // 아래 crawler 분기가 막는 것과 똑같이 몸이 바닥 아래로 묻힌다. 그 분기를 만들 때
    // scream 이 위에 있어서 같이 안 고쳐졌다. 실측: 플레이어를 발견한 포복체의
    // 가장 낮은 뼈가 **-0.50m** (3F 40회 순회 중 6회, 전부 클립 scream).
    // 소리는 그대로 난다 — `_screamTimer` 는 클립이 아니라 발견 시점에 걸린다.
    if (this._screamTimer > 0 && !this.def.crawler) return 'scream';
    // 기어다니는 개체는 서는 동작이 없다 — 이동/정지/공격 전부 엎드린 클립을 쓴다.
    // **공격 판정을 ATTACK 보다 먼저 본다.** 선 자세 공격 클립을 쓰면 modelYOffset(-0.62)
    // 때문에 몸이 바닥 아래로 묻힌다 (tools/qa_motion.js 가 잡았다).
    if (this.def.crawler) {
      if (this.state === 'ATTACK' || this.state === 'GRAB') return 'crawl';
      return this._moveSpeed > 0.15 ? 'crawl' : 'crawlIdle';
    }
    // 물고 있는 동안도 공격 클립을 쓴다 — 느리게 돌려 매달려 버둥거리는 것처럼 보인다
    if (this.state === 'ATTACK' || this.state === 'GRAB') return 'attack';
    if (this.state === 'CHASE') return 'run';
    return this._moveSpeed > 0.25 ? 'walk' : 'idle';
  }

  _updateAnim(dt) {
    if (!this.mixer) return;
    this._sinceHit = (this._sinceHit ?? 99) + dt;   // 재피격 되감기 간격 (ANIM.hitRetriggerMin)

    // 실제 이동 속도 — 걷기/서기 판정과 재생속도에 쓴다
    const moved = Math.hypot(this.pos.x - this._prevX, this.pos.z - this._prevZ);
    this._moveSpeed = dt > 0 ? moved / dt : 0;
    this._prevX = this.pos.x; this._prevZ = this.pos.z;

    const key = this._animKey();
    const next = this.actions?.[key] ?? this.actions?.idle;
    // **재피격은 같은 클립이어도 되감는다.** 예전에는 `next !== curAnim` 일 때만
    // 리셋해서, 플린치 도중에 또 맞으면 클립이 이전 위치에서 그냥 이어졌다.
    // 권총 쿨다운(0.28s)이 플린치(0.42s)보다 짧아 **연사하면 2발째부터 몸이
    // 반응을 멈췄다** — 예외가 아니라 기본 동작이었다.
    const restart = this._hitRestart && key === 'hit';
    if (next && (next !== this.curAnim || restart)) {
      // **스폰 직후에는 페이드가 없다.** curAnim 이 없다는 건 믹서가 비어 있다는 뜻이고,
      // 그 상태로 페이드인하면 나머지 가중치를 three 가 **바인드 포즈(T포즈)** 로 채운다.
      // 즉 첫 0.22초 동안 화면에 나오는 것은 걷기가 아니라 "T포즈와 걷기의 중간"이다.
      // _phase 가 어디에 떨어지느냐에 따라 그 중간 자세의 발이 바닥을 최대 10cm 뚫었다
      // (풀 20개체 중 2~4개, 재현: scratchpad/qa/floor_probe.mjs).
      // 처음 재생하는 클립은 곧바로 전체 가중치로 튼다 — 섞을 이전 자세가 애초에 없다.
      const fadeIn = !this.curAnim ? ANIM.spawnFade
        : key === 'hit' ? ANIM.hitFadeIn : ANIM.fade;
      next.reset().fadeIn(fadeIn).play();
      // **걷기·달리기는 개체마다 다른 지점에서 시작한다.**
      // reset() 은 0 으로 되감는데, 그러면 같은 순간에 걷기 시작한 개체들이
      // 발을 맞춰 행진한다 — 걷기 클립이 둘뿐이라 이게 가장 크게 티가 난다.
      if (key === 'walk' || key === 'run') next.time = this._phase * next.getClip().duration;
      // 피격 클립은 앞 15~20% 가 정지 구간이다. 0 부터 재생하면 반응 창의 40% 를
      // 아무것도 안 하는 데 쓰고 최대로 젖혀지기 전에 창이 닫힌다 (hit_03 은 최대점에
      // 아예 도달하지 못했다). 움직이기 시작하는 지점부터 재생한다.
      if (key === 'hit') next.time = ANIM.hitOnset[next.getClip().name] ?? ANIM.hitOnsetDefault;
      if (this.curAnim && this.curAnim !== next) {
        this.curAnim.fadeOut(this.curAnim === this.actions?.hit ? ANIM.hitFadeOut : ANIM.fade);
      }
      // **사망은 curAnim 하나만 빼는 것으로 부족하다.**
      //
      // 여기는 직전 클립 하나만 페이드아웃한다. 평소에는 그걸로 충분한데,
      // 전환이 페이드보다 빨리 일어나면(달리다 → 맞고 → 공격) 앞의 것들이 다 빠지기
      // 전에 다음 것이 올라온다. 게다가 `_startSwing` 은 공격 클립을 `_updateAnim` 을
      // 거치지 않고 `reset().play()` 로 되감는다 — 그 순간 가중치가 다시 1 이 된다.
      // 그렇게 **run·attack·hit 이 셋 다 가중치 1 로 남은 채** 죽으면, 사망 클립이
      // 끝까지 재생돼도 최종 자세가 넷의 평균이라 시체가 **선 채로 굳는다**
      // (실측: 죽기 전 state=ATTACK, death 가중치 1·시각 4.97/4.97 인데 몸높이 1.33m).
      // 사망은 되돌아올 수 없는 상태이므로 여기서 나머지를 전부 내려도 안전하다.
      if (key === 'death') {
        for (const a of Object.values(this.actions ?? {})) {
          if (a && a !== next) a.fadeOut(ANIM.fade);
        }
      }
      this.curAnim = next;
      this._hitRestart = false;
    }
    // 걷기/달리기는 실제 속도에 맞춰 재생속도를 조절한다 (발이 미끄러지지 않게)
    if (next && (key === 'walk' || key === 'run')) {
      // **기준은 설계속도가 아니라 클립의 원래 속도다.** 예전에는 speedWander 로 나눴는데,
      // 그건 설계속도와 클립의 원래 속도가 같다는 전제가 필요하다. 실제로는 0.30~2.08 로
      // 제각각이라 모든 걷기가 상한에 걸린 채 **그대로 미끄러졌다.**
      // (실측: tools/measure_contact.js 의 measureStride)
      const ref = ANIM.clipSpeed[next.getClip().name] ?? ANIM.clipSpeedDefault;
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
      //
      // **남은 길이(duration - onset)로 나눠야 한다.** onset 만큼 앞을 건너뛰었으므로
      // duration 을 그대로 쓰면 클립이 플린치보다 먼저 끝나고, clampWhenFinished
      // 때문에 좀비가 **젖혀진 자세로 얼어붙는다** (둔기처럼 스턴이 긴 무기에서 드러난다).
      const clip = next.getClip();
      const onset = ANIM.hitOnset[clip.name] ?? ANIM.hitOnsetDefault;
      next.timeScale = Math.min(ANIM.hitMaxSpeed,
        (clip.duration - onset) / Math.max(this._flinchTotal, 0.2));
    } else if (next && key === 'attack') {
      // **배속을 여기서 정하지 않는다.** 스윙 시작(`_startSwing`)이 클립을 되감으면서
      // 같이 정한다 — 데미지가 들어가는 시점을 그 배속에서 역산하기 때문에, 여기서
      // 매 프레임 덮어쓰면 두 값이 다시 어긋난다.
      // 물고 있는 동안만 예외로 느리게 돌린다(매달려 버둥거리는 느낌).
      if (this.state === 'GRAB') next.timeScale = 0.55 * this._jitter;
    } else if (next && key === 'death') {
      // 원본이 3초라 그대로 두면 너무 느리게 쓰러져 답답하다.
      // 배속은 사망 시점에 지터까지 포함해 역산해 둔다 (hit() 참조) — 여기서 또
      // 곱하면 상한 밖으로 나간다.
      next.timeScale = this._deathSpeed ?? (CORPSE.deathSpeed * this._jitter);
    } else if (next) {
      next.timeScale = this._jitter;
    }
    if (this._screamTimer > 0) this._screamTimer -= dt;
    if (this.flinch > 0) {
      this.flinch -= dt;
      // 충격으로 몸이 젖혀진다 — 애니메이션만으로는 타격감이 약하다.
      //
      // **감쇠 진동이다.** 예전 식(sin(t*PI/2))은 첫 프레임이 이미 최댓값이고 그 뒤로는
      // 줄기만 했다 — 팝으로 튀어나왔다 스르르 사라지는 곡선이라 "기울었다"로 보였다.
      // 실제 타격은 (a) 아주 짧은 상승 (b) 최대 (c) 반대쪽으로 오버슈트 (d) 수렴 이고,
      // 역동감은 (c) 에서 나온다.
      const t = Math.max(0, this.flinch / Math.max(this._flinchTotal, 0.01));
      const u = 1 - t;                                   // 경과 비율 0 → 1
      this._bend = (1 - Math.exp(-u / KNOCK.punchIn))    // 짧은 상승
        * Math.exp(-KNOCK.punchDamp * u)                 // 감쇠
        * Math.cos(KNOCK.punchFreq * u)                  // 되튐
        * (this._flinchPower ?? 1);
    } else if (this._bend) {
      this._bend = 0;
    }
    // 몸통이 밀리는 최소량만 group 에 남긴다. **여기가 발이 바닥을 파고들 수 있는
    // 유일한 통로**라 groupBend 를 작게 유지한다 (알려진 함정: sin(각도) x 0.19m).
    // 뼈가 없으면(캡슐 폴백) 예전처럼 group 이 반동을 통째로 맡는다.
    if (this.state !== 'DEAD') {
      const gb = this._bend
        * (this._punchBones?.length ? KNOCK.groupBend : KNOCK.boneBend);
      this.group.rotation.x = -gb * (this._flinchZ ?? 1);
      this.group.rotation.z = gb * (this._flinchX ?? 0) * 0.8;
    }

    // 보이는 위치만 뒤로 밀린다 (좌표는 그대로 — 벽을 뚫거나 경로가 꼬이면 안 된다)
    if (this._knockT > 0) {
      this._knockT = Math.max(0, this._knockT - dt);
      const k = this._knockT / Math.max(this._knockTotal, 0.01);
      const amt = KNOCK.distance * k * k;
      this.group.position.x += this._knockX * amt;
      this.group.position.z += this._knockZ * amt;
    }

    // ── 런지 ──
    // 변환할 때 루트 이동을 전부 지워서(fbx_to_glb.py) 좀비는 **제자리에서만 휘두른다.**
    // 그래서 아무리 세게 때려도 몸이 안 나온다. 접촉 시점까지 앞으로 파고들었다가
    // 조금 되돌아오게 하면 체중이 실린다. 여기도 **보이는 위치만** 건드린다.
    if (this.state === 'ATTACK' && this._swingContact > 0) {
      const t = this._swingT / this._swingContact;
      let f = 0;
      if (t > 0 && t <= 1) f = t * t;                        // 파고드는 구간
      else if (t > 1) f = Math.max(0, 1 - (t - 1) * (1 / ATTACK.lungeBack));  // 되돌아오는 구간
      if (f > 0) {
        const amt = ATTACK.lunge * f;
        this.group.position.x += -Math.sin(this.facing) * amt;
        this.group.position.z += -Math.cos(this.facing) * amt;
      }
    }

    // 히트스톱 — 닿는 순간 이쪽 동작도 멈춘다. 한쪽만 멈추면 부딪힌 게 아니라
    // 맞은 쪽만 경련한 것처럼 보인다.
    if (this._hitstop > 0) {
      this._hitstop -= dt;
      this.mixer.update(0);
      this._mixAcc = 0;
      this._punch();
      return;
    }

    /*
     * 먼 개체는 믹서를 **매 프레임 돌리지 않는다.**
     *
     * mixer.update 는 뼈 65개 x 트랙 2~3개를 보간해서 쓴다. 14마리면 프레임마다
     * 1800회가 넘는데, 20m 밖의 좀비는 화면에서 손가락 한 마디 크기라 30fps 로
     * 움직여도 눈으로 구분되지 않는다. 건너뛴 만큼 dt 를 모아서 한 번에 넘기므로
     * **동작이 느려지지 않는다** — 프레임 수만 줄어든다.
     *
     * 예외는 가까이 붙은 상태(공격·붙잡기)와 시체(_groundOffset 이 매 프레임 자세를
     * 읽는다), 그리고 피격 중이다. 총으로 먼 좀비를 맞히는 순간이 하필 플레이어가
     * 그놈을 제일 열심히 보고 있는 순간이다.
     */
    const d = this._distToPlayer ?? 0;
    const always = this.state === 'ATTACK' || this.state === 'GRAB'
      || this.state === 'DEAD' || this.flinch > 0 || this.stun > 0;
    const stride = always || d < ANIM.lodNear ? 1
      : d < ANIM.lodFar ? ANIM.lodStepNear : ANIM.lodStepFar;

    this._mixAcc = (this._mixAcc ?? 0) + dt;
    this._mixWait = (this._mixWait ?? 0) - 1;
    // stride 가 1 이면 **무조건** 돈다. 멀리 있다가 다가오는 개체가 남은 대기값
    // 때문에 두 프레임 얼어붙는 것을 막는다 — 하필 다가오는 순간에 티가 난다.
    if (stride > 1 && this._mixWait > 0) return;
    this._mixWait = stride;
    this.mixer.update(this._mixAcc);
    this._mixAcc = 0;
    // **믹서가 돈 프레임에만** 반동을 얹는다. 안 그러면 같은 쿼터니언에 두 번
    // 곱해져 누적된다 — 덮어쓰기에 기대는 구조라(위 주석) 이 순서가 곧 규약이다.
    this._punch();
  }

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
  _punch() {
    const bones = this._punchBones;
    if (!bones?.length) return;
    // 시체에는 절대 걸지 않는다. `_groundOffset()` 이 "지금 자세에서 가장 낮은 뼈"를
    // 읽어 바닥에 붙이는데, 거기에 반동이 얹히면 시체가 뜨거나 묻힌다.
    if (this.state === 'DEAD' || !this._bend) return;

    const amp = this._bend * KNOCK.boneBend;
    const pitch = -amp * (this._flinchZ ?? 1);   // 맞은 방향으로 젖힌다
    const roll = amp * (this._flinchX ?? 0);     // 옆에서 맞으면 비틀린다
    for (let i = 0; i < bones.length; i++) {
      const w = this._punchW[i];
      if (!w) continue;
      _e.set(pitch * w, 0, roll * w);
      bones[i].quaternion.multiply(_q.setFromEuler(_e));
    }
  }

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
  _groundOffset() {
    if (!this.model) return 0;
    // 이 한 줄이 서브트리 전체의 matrixWorld 를 최신으로 만든다. 지우면 한 프레임
    // 늦은 자세로 접지해서 시체가 미세하게 떤다 — 순서가 곧 규약이다.
    this.group.updateMatrixWorld(true);
    let lowest = Infinity;
    // **getWorldPosition 을 쓰면 안 된다.** 내부에서 뼈마다 루트까지 부모 체인을
    // 다시 계산해서, 방금 위에서 구한 값을 뼈 65개 x 깊이 7 = 450여 번 다시 구한다.
    // 하필 웨이브에서 서너 마리가 동시에 쓰러지는, 프레임이 가장 빡빡한 순간에 겹친다.
    // 이미 최신인 matrixWorld 에서 위치만 읽는다. 뼈 목록도 부착 시 한 번만 모은다.
    const bones = this._bones;
    for (let i = 0; i < bones.length; i++) {
      _tmp.setFromMatrixPosition(bones[i].matrixWorld);
      if (_tmp.y < lowest) lowest = _tmp.y;
    }
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
  hit(damage, stun = 0, headshot = false, from = null, kind = 'blunt') {
    if (!this.active || this.state === 'DEAD') return;
    this.hp -= damage;
    this.stun = Math.max(this.stun, stun / (this.def.stunResist || 1));
    if (headshot) this.stun += 0.15;
    // 플린치는 연출 전용 — AI 를 멈추지 않는다. 스턴이 0인 총알도 움찔하게 만든다.
    this._flinchTotal = Math.max(0.42, this.stun);
    this.flinch = this._flinchTotal;

    /**
     * 데미지가 반응 **크기**에 들어간다 (시간이 아니다 — 시간을 늘리면 AI 가 멈춘 것처럼
     * 보인다). 예전에는 권총 1발과 도끼 한 방이 픽셀 단위로 똑같이 움찔했다.
     * 플린치가 진행 중이면 더한다 — 같은 프레임에 여러 발이 박히면 자연히 합산된다.
     * **밀림(KNOCK.distance)에는 절대 곱하지 않는다.** 밀림을 키우면 무게가 사라지고
     * 그것만 눈에 띈다 (0.34 → 0.18 로 줄인 기록이 balance.js 에 있다).
     */
    const add = damage / KNOCK.powerRef;
    this._flinchPower = Math.min(KNOCK.powerMax,
      Math.max(KNOCK.powerMin, (this.flinch > 0 ? (this._flinchPower ?? 0) : 0) + add));

    // 같은 프레임에 여러 발이 들어와도 되감기는 한 번만 — 연달아 reset 하면
    // 클립이 첫 프레임에 고정돼 **완전히 멈춘 것처럼 보인다.**
    if ((this._sinceHit ?? 99) >= ANIM.hitRetriggerMin) {
      this._hitRestart = true;
      // 맞을 때마다 반응 클립을 새로 뽑는다. 고정해 두면 한 마리가 평생 같은
      // 동작으로만 움찔한다 — 파일에는 3종이 들어 있는데 로드 시점에 얼어붙었다.
      // 지금 그 클립을 재생 중이면 건드리지 않는다(재생 중 교체는 자세가 튄다).
      if (this.curAnim !== this.actions?.hit) this._roll?.('hit');
    }
    this._sinceHit = 0;

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

    // 피격음 — 날붙이는 살을 가르는 소리, 둔기(스턴 큼)는 뼈 소리,
    // 총알은 살점 소리, 헤드샷은 따로.
    // `melee_hit`(sfx_axe_hit_flesh.mp3)은 등록만 되고 두 세션 동안 한 번도
    // 재생되지 않았다 — 소방도끼와 쇠파이프가 완전히 같은 소리를 내고 있었다.
    const impact = headshot ? 'hit_headshot'
      : kind === 'blade' ? 'melee_hit'
        : stun >= 0.8 ? `hit_blunt_${1 + ((Math.random() * 2) | 0)}`
          : `hit_flesh_${1 + ((Math.random() * 2) | 0)}`;
    bus.emit(EV.SFX, { name: impact, x: this.pos.x, z: this.pos.z, volume: 0.95 });
    // 맞은 자리에서 피가 튄다. 머리를 맞았으면 더 높은 곳에서, 더 많이.
    // headshot 을 불리언으로 같이 보낸다 — HUD 마커와 화면흔들림이 읽는다.
    // power 값(1.8)으로 구분하게 하면 HUD 에 매직넘버가 생긴다.
    bus.emit(EV.ZOMBIE_HIT, {
      x: this.pos.x,
      y: this.def.height * (headshot ? 0.86 : 0.62),
      z: this.pos.z,
      nx: kx, nz: kz,
      power: headshot ? 1.8 : 1,
      headshot,
    });

    if (this.hp <= 0) {
      this.state = 'DEAD';
      this.deathTimer = CORPSE.linger;
      // 쓰러지는 자세도 매번 새로 뽑는다 — 고정하면 한 마리가 늘 같은 자세로 죽는다
      this._roll?.('death');
      // 클립 길이가 3.00~4.97초로 제각각이라 상수 배속을 쓰면 쓰러지는 시간이
      // 1.8초와 3.0초로 갈린다. **걸리는 시간**을 맞추고 배속을 역산한다.
      // **지터는 clamp 안에서 곱한다** — 밖에서 곱하면 상한을 걸어 놓고 그 위를
      // 넘긴다. 이 프로젝트가 걷기·공격에서 이미 두 번 밟은 함정이고,
      // tools/qa_motion.js 의 배속 검사가 존재하는 이유가 바로 이것이다.
      const dClip = this.actions?.death?.getClip?.().duration ?? 1.5;
      this._deathSpeed = THREE.MathUtils.clamp(
        (dClip / CORPSE.deathTargetSec) * this._jitter,
        CORPSE.deathSpeedMin, CORPSE.deathSpeedMax);
      // 바닥 고정 시점을 **클립 길이에서 구한다.** 고정값(예전 1.6초)을 쓰면 3초짜리
      // 사망 클립이 아직 움직이는 중에 위치가 잠겨서 뼈가 바닥을 뚫고 내려갔다.
      this._settleAt = dClip / this._deathSpeed + CORPSE.settleMargin;
      this._thudDone = false;
      // 죽는 순간이 평타와 거의 구별되지 않았다 — 죽음 소리가 피격음(0.95)보다
      // **오히려 조용했고**, 사망 전용 버스트가 없었다. 크고 밝게 한 번 더 터뜨린다.
      // **`headshot` 이 아니라 `hot` 이다.** headshot 은 생김새만 바꾸는 값이 아니라
      // 의미 플래그다 — Player 가 헤드샷 전용 화면흔들림을, HUD 가 헤드샷 히트마커를
      // 같이 읽는다. 여기에 true 를 넣으면 **몸통을 쳐서 죽여도 매번 헤드샷 반동**이
      // 오고, 머리를 한 번도 안 맞혔는데 헤드샷 마커가 번쩍인다.
      // 사망 버스트에 필요한 것은 "크고 밝고 높이"뿐이므로 hot 만 켠다.
      bus.emit(EV.ZOMBIE_HIT, {
        x: this.pos.x, y: this.def.height * DEATH.burstY, z: this.pos.z,
        nx: kx, nz: kz, power: DEATH.burstPower, hot: true,
      });
      bus.emit(EV.SFX, {
        name: 'zombie_death', x: this.pos.x, z: this.pos.z, volume: DEATH.sfxVolume,
      });
      bus.emit(EV.ZOMBIE_DIED, { x: this.pos.x, z: this.pos.z, type: this.typeKey });
    } else if (this.state !== 'CHASE') {
      this.state = 'CHASE';
      bus.emit(EV.SFX, { name: 'zombie_alert', x: this.pos.x, z: this.pos.z, volume: 0.9 });
    }
  }

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
  _startSwing(delay = 0) {
    this._swingT = -delay;                       // 음수 구간이 예비동작이다
    this._swingHit = false;
    this._swingLen = this.def.attackCooldown;

    // 포복체는 엎드린 공격 클립이 없어 crawl 을 빠르게 돌린다(ANIM). 그 클립은
    // 이동에도 쓰이므로 스윙마다 되감으면 기는 동작이 뚝뚝 끊긴다 — 건드리지 않는다.
    const a = this.def.crawler ? null : this.actions?.attack;
    if (!a) { this._swingContact = this._swingLen * ATTACK.contactDefault; return; }

    const clip = a.getClip();
    // 한 번 휘두르는 시간을 쿨다운에 맞춘다. **상한을 걸어야 한다** — 4.5초짜리
    // 클립을 1.1초 쿨다운에 맞추면 4.5배속이 되어 팔이 경련한다.
    // 지터는 clamp 안에서 곱한다 (밖에서 곱하면 상한 2.0 을 걸어 놓고 2.16 이 나온다).
    const scale = THREE.MathUtils.clamp(
      (clip.duration / this._swingLen) * this._jitter,
      ANIM.attackMinSpeed, ANIM.attackMaxSpeed);
    a.timeScale = scale;
    a.reset().play();                            // **스윙마다 처음부터** — 위상이 안 어긋난다

    // 클립 안의 접촉 지점(0~1)을 실제 초로 바꾼다. 배속을 나눠야 한다.
    const f = ATTACK.contact[clip.name] ?? ATTACK.contactDefault;
    // 상한에 걸려 동작이 쿨다운보다 일찍 끝나면 접촉도 그만큼 앞당겨진다 — 그게 맞다.
    this._swingContact = Math.min((clip.duration * f) / scale, this._swingLen);
  }

  _attack(dt, player, dist, collision) {
    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
    this.facing = Math.atan2(-dx, -dz);

    if (dist > this.def.attackRange * 1.35) { this.state = 'CHASE'; return; }

    // 벽 너머로 때리지 못하게 한다. 거리만 보면 문틈·모서리를 사이에 두고도 맞는다.
    if (collision?.segmentBlocked(this.pos.x, this.pos.z, player.pos.x, player.pos.z)) {
      this.state = 'CHASE';
      return;
    }

    this._swingT += dt;

    // 팔이 가장 뻗은 그 프레임에 들어간다
    if (!this._swingHit && this._swingT >= this._swingContact) {
      this._swingHit = true;
      this._land(player);
    }

    if (this._swingT >= this._swingLen) this._startSwing();
  }

  /** 타격이 닿은 순간 — 여기서만 데미지·소리·물림이 일어난다 */
  _land(player) {
    bus.emit(EV.SFX, { name: 'zombie_attack', x: this.pos.x, z: this.pos.z, volume: 1 });
    this._hitstop = ATTACK.hitstop;      // 때린 쪽도 멈춘다. 한쪽만 멈추면 부딪힌 게 아니다

    // 물릴 것인가. **닿았을 때만** 판정한다 — 헛스윙에 물리면 억울하다.
    if (GRAB.enabled && player.canBeGrabbed?.() && Math.random() < GRAB.chance) {
      this.state = 'GRAB';
      player.beginGrab(this);
      bus.emit(EV.GRAB_START, { x: this.pos.x, z: this.pos.z });
      return;
    }
    player.damage(this.def.damage, this.pos);
  }

  /**
   * 물고 있는 동안. 놓아주는 판단은 **Player 쪽이 한다** —
   * 뿌리치기 입력과 시간 초과를 한 곳에서 보는 편이 어긋날 여지가 없다.
   */
  _grab(dt, player) {
    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    this.facing = Math.atan2(-dx, -dz);

    // 붙잡은 거리까지 끌어당긴다. 플레이어를 끄는 게 아니라 좀비가 파고든다 —
    // 플레이어 좌표를 건드리면 벽에 밀어넣을 수 있다.
    const want = GRAB.holdDistance;
    if (d > want) {
      const k = Math.min(1, (d - want) * dt * 6);
      this.pos.x += (dx / d) * (d - want) * k;
      this.pos.z += (dz / d) * (d - want) * k;
    }

    // 풀렸으면 돌아간다. (뿌리쳐진 경우의 경직은 onGrabBroken 이 따로 건다)
    if (player.grabbedBy !== this) this.state = 'CHASE';
  }

  /** Player 가 뿌리쳤을 때 부른다 */
  onGrabBroken() {
    this.stun = Math.max(this.stun, GRAB.releaseStun);
    this.state = 'CHASE';
    // 밀려나는 건 보이는 위치만 (좌표를 밀면 벽을 뚫는다 — KNOCK 과 같은 규약)
    this._knockT = this._knockTotal = KNOCK.duration;
    const s = Math.sin(this.facing), c = Math.cos(this.facing);
    this._knockX = s * GRAB.releasePush;
    this._knockZ = c * GRAB.releasePush;
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
