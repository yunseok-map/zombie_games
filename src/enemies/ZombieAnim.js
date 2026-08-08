/**
 * ZombieAnim — 상태 → 클립 선택, 클립 재생·속도·블렌딩, 상체 반동, 시체 접지.
 *
 * Zombie.js 에서 갈라져 나왔다. 개체가 첫 인자(z)로 들어오고 나머지는 그대로다.
 * Zombie 클래스에는 같은 이름의 한 줄 위임이 남아 있으므로 **부르는 쪽은 안 바뀐다.**
 *
 * 여기 있는 값의 근거는 대부분 실측이다 — 주석의 수치를 감으로 고치지 마라.
 */

import * as THREE from 'three';
import { ZOMBIE, ANIM, KNOCK, CORPSE, DEATH, ATTACK } from '../config/balance.js';

// 뼈 반동용 임시값 — 매 프레임 만들면 그것만으로 GC 가 돈다 (좀비 14마리 x 뼈 5개)
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _tmp = new THREE.Vector3();

  /** 상태 → 클립 종류 */
export function _animKey(z) {
    if (z.state === 'DEAD') return 'death';
    if (z.stun > 0 || z.flinch > 0) return 'hit';
    // 발견 순간의 포효. **기어다니는 개체는 제외한다** — 이것도 선 자세 클립이라
    // 아래 crawler 분기가 막는 것과 똑같이 몸이 바닥 아래로 묻힌다. 그 분기를 만들 때
    // scream 이 위에 있어서 같이 안 고쳐졌다. 실측: 플레이어를 발견한 포복체의
    // 가장 낮은 뼈가 **-0.50m** (3F 40회 순회 중 6회, 전부 클립 scream).
    // 소리는 그대로 난다 — `_screamTimer` 는 클립이 아니라 발견 시점에 걸린다.
    if (z._screamTimer > 0 && !z.def.crawler) return 'scream';
    // 기어다니는 개체는 서는 동작이 없다 — 이동/정지/공격 전부 엎드린 클립을 쓴다.
    // **공격 판정을 ATTACK 보다 먼저 본다.** 선 자세 공격 클립을 쓰면 modelYOffset(-0.62)
    // 때문에 몸이 바닥 아래로 묻힌다 (tools/qa_motion.js 가 잡았다).
    if (z.def.crawler) {
      // 멈춰 있어도 crawl 을 쓴다 — crawl_idle 은 무릎 꿇은 자세라 다리가 바닥에
      // 잠긴다 (ANIM.crawlerIdleSpeed 주석에 실측값). 대신 느리게 돌린다.
      return 'crawl';
    }
    // 물고 있는 동안도 공격 클립을 쓴다 — 느리게 돌려 매달려 버둥거리는 것처럼 보인다
    if (z.state === 'ATTACK' || z.state === 'GRAB') return 'attack';
    if (z.state === 'CHASE') return 'run';
    return z._moveSpeed > 0.25 ? 'walk' : 'idle';
}

export function _updateAnim(z, dt) {
    if (!z.mixer) return;
    z._sinceHit = (z._sinceHit ?? 99) + dt;   // 재피격 되감기 간격 (ANIM.hitRetriggerMin)

    // 실제 이동 속도 — 걷기/서기 판정과 재생속도에 쓴다
    const moved = Math.hypot(z.pos.x - z._prevX, z.pos.z - z._prevZ);
    z._moveSpeed = dt > 0 ? moved / dt : 0;
    z._prevX = z.pos.x; z._prevZ = z.pos.z;

    const key = z._animKey();
    const next = z.actions?.[key] ?? z.actions?.idle;
    // **재피격은 같은 클립이어도 되감는다.** 예전에는 `next !== curAnim` 일 때만
    // 리셋해서, 플린치 도중에 또 맞으면 클립이 이전 위치에서 그냥 이어졌다.
    // 권총 쿨다운(0.28s)이 플린치(0.42s)보다 짧아 **연사하면 2발째부터 몸이
    // 반응을 멈췄다** — 예외가 아니라 기본 동작이었다.
    const restart = z._hitRestart && key === 'hit';
    if (next && (next !== z.curAnim || restart)) {
      // **스폰 직후에는 페이드가 없다.** curAnim 이 없다는 건 믹서가 비어 있다는 뜻이고,
      // 그 상태로 페이드인하면 나머지 가중치를 three 가 **바인드 포즈(T포즈)** 로 채운다.
      // 즉 첫 0.22초 동안 화면에 나오는 것은 걷기가 아니라 "T포즈와 걷기의 중간"이다.
      // _phase 가 어디에 떨어지느냐에 따라 그 중간 자세의 발이 바닥을 최대 10cm 뚫었다
      // (풀 20개체 중 2~4개, 재현: scratchpad/qa/floor_probe.mjs).
      // 처음 재생하는 클립은 곧바로 전체 가중치로 튼다 — 섞을 이전 자세가 애초에 없다.
      const fadeIn = !z.curAnim ? ANIM.spawnFade
        : key === 'hit' ? ANIM.hitFadeIn : ANIM.fade;
      next.reset().fadeIn(fadeIn).play();
      // **걷기·달리기는 개체마다 다른 지점에서 시작한다.**
      // reset() 은 0 으로 되감는데, 그러면 같은 순간에 걷기 시작한 개체들이
      // 발을 맞춰 행진한다 — 걷기 클립이 둘뿐이라 이게 가장 크게 티가 난다.
      if (key === 'walk' || key === 'run') next.time = z._phase * next.getClip().duration;
      // 피격 클립은 앞 15~20% 가 정지 구간이다. 0 부터 재생하면 반응 창의 40% 를
      // 아무것도 안 하는 데 쓰고 최대로 젖혀지기 전에 창이 닫힌다 (hit_03 은 최대점에
      // 아예 도달하지 못했다). 움직이기 시작하는 지점부터 재생한다.
      if (key === 'hit') next.time = ANIM.hitOnset[next.getClip().name] ?? ANIM.hitOnsetDefault;
      if (z.curAnim && z.curAnim !== next) {
        z.curAnim.fadeOut(z.curAnim === z.actions?.hit ? ANIM.hitFadeOut : ANIM.fade);
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
        for (const a of Object.values(z.actions ?? {})) {
          if (a && a !== next) a.fadeOut(ANIM.fade);
        }
      }
      z.curAnim = next;
      z._hitRestart = false;
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
        (z._moveSpeed / Math.max(ref, 0.1)) * z._jitter,
        ANIM.moveMinSpeed, ANIM.moveMaxSpeed);
    } else if (next && key === 'crawl') {
      // 포복체의 공격은 기는 동작을 빠르게 돌린 것이다 (엎드린 공격 클립이 없다)
      next.timeScale = (z.state === 'ATTACK' ? ANIM.crawlerAttackSpeed
        : z._moveSpeed > 0.15 ? 1 : ANIM.crawlerIdleSpeed) * z._jitter;
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
        (clip.duration - onset) / Math.max(z._flinchTotal, 0.2));
    } else if (next && key === 'attack') {
      // **배속을 여기서 정하지 않는다.** 스윙 시작(`_startSwing`)이 클립을 되감으면서
      // 같이 정한다 — 데미지가 들어가는 시점을 그 배속에서 역산하기 때문에, 여기서
      // 매 프레임 덮어쓰면 두 값이 다시 어긋난다.
      // 물고 있는 동안만 예외로 느리게 돌린다(매달려 버둥거리는 느낌).
      if (z.state === 'GRAB') next.timeScale = 0.55 * z._jitter;
    } else if (next && key === 'death') {
      // 원본이 3초라 그대로 두면 너무 느리게 쓰러져 답답하다.
      // 배속은 사망 시점에 지터까지 포함해 역산해 둔다 (hit() 참조) — 여기서 또
      // 곱하면 상한 밖으로 나간다.
      next.timeScale = z._deathSpeed ?? (CORPSE.deathSpeed * z._jitter);
    } else if (next) {
      next.timeScale = z._jitter;
    }
    if (z._screamTimer > 0) z._screamTimer -= dt;
    if (z.flinch > 0) {
      z.flinch -= dt;
      // 충격으로 몸이 젖혀진다 — 애니메이션만으로는 타격감이 약하다.
      //
      // **감쇠 진동이다.** 예전 식(sin(t*PI/2))은 첫 프레임이 이미 최댓값이고 그 뒤로는
      // 줄기만 했다 — 팝으로 튀어나왔다 스르르 사라지는 곡선이라 "기울었다"로 보였다.
      // 실제 타격은 (a) 아주 짧은 상승 (b) 최대 (c) 반대쪽으로 오버슈트 (d) 수렴 이고,
      // 역동감은 (c) 에서 나온다.
      const t = Math.max(0, z.flinch / Math.max(z._flinchTotal, 0.01));
      const u = 1 - t;                                   // 경과 비율 0 → 1
      z._bend = (1 - Math.exp(-u / KNOCK.punchIn))    // 짧은 상승
        * Math.exp(-KNOCK.punchDamp * u)                 // 감쇠
        * Math.cos(KNOCK.punchFreq * u)                  // 되튐
        * (z._flinchPower ?? 1);
    } else if (z._bend) {
      z._bend = 0;
    }
    // 몸통이 밀리는 최소량만 group 에 남긴다. **여기가 발이 바닥을 파고들 수 있는
    // 유일한 통로**라 groupBend 를 작게 유지한다 (알려진 함정: sin(각도) x 0.19m).
    // 뼈가 없으면(캡슐 폴백) 예전처럼 group 이 반동을 통째로 맡는다.
    if (z.state !== 'DEAD') {
      const gb = z._bend
        * (z._punchBones?.length ? KNOCK.groupBend : KNOCK.boneBend);
      z.group.rotation.x = -gb * (z._flinchZ ?? 1);
      z.group.rotation.z = gb * (z._flinchX ?? 0) * 0.8;
    }

    // 보이는 위치만 뒤로 밀린다 (좌표는 그대로 — 벽을 뚫거나 경로가 꼬이면 안 된다)
    if (z._knockT > 0) {
      z._knockT = Math.max(0, z._knockT - dt);
      const k = z._knockT / Math.max(z._knockTotal, 0.01);
      const amt = KNOCK.distance * k * k;
      z.group.position.x += z._knockX * amt;
      z.group.position.z += z._knockZ * amt;
    }

    // ── 런지 ──
    // 변환할 때 루트 이동을 전부 지워서(fbx_to_glb.py) 좀비는 **제자리에서만 휘두른다.**
    // 그래서 아무리 세게 때려도 몸이 안 나온다. 접촉 시점까지 앞으로 파고들었다가
    // 조금 되돌아오게 하면 체중이 실린다. 여기도 **보이는 위치만** 건드린다.
    if (z.state === 'ATTACK' && z._swingContact > 0) {
      const t = z._swingT / z._swingContact;
      let f = 0;
      if (t > 0 && t <= 1) f = t * t;                        // 파고드는 구간
      else if (t > 1) f = Math.max(0, 1 - (t - 1) * (1 / ATTACK.lungeBack));  // 되돌아오는 구간
      if (f > 0) {
        const amt = ATTACK.lunge * f;
        z.group.position.x += -Math.sin(z.facing) * amt;
        z.group.position.z += -Math.cos(z.facing) * amt;
      }
    }

    // 히트스톱 — 닿는 순간 이쪽 동작도 멈춘다. 한쪽만 멈추면 부딪힌 게 아니라
    // 맞은 쪽만 경련한 것처럼 보인다.
    if (z._hitstop > 0) {
      z._hitstop -= dt;
      z.mixer.update(0);
      z._mixAcc = 0;
      z._punch();
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
    const d = z._distToPlayer ?? 0;
    const always = z.state === 'ATTACK' || z.state === 'GRAB'
      || z.state === 'DEAD' || z.flinch > 0 || z.stun > 0;
    const stride = always || d < ANIM.lodNear ? 1
      : d < ANIM.lodFar ? ANIM.lodStepNear : ANIM.lodStepFar;

    z._mixAcc = (z._mixAcc ?? 0) + dt;
    z._mixWait = (z._mixWait ?? 0) - 1;
    // stride 가 1 이면 **무조건** 돈다. 멀리 있다가 다가오는 개체가 남은 대기값
    // 때문에 두 프레임 얼어붙는 것을 막는다 — 하필 다가오는 순간에 티가 난다.
    if (stride > 1 && z._mixWait > 0) return;
    z._mixWait = stride;
    z.mixer.update(z._mixAcc);
    z._mixAcc = 0;
    // **믹서가 돈 프레임에만** 반동을 얹는다. 안 그러면 같은 쿼터니언에 두 번
    // 곱해져 누적된다 — 덮어쓰기에 기대는 구조라(위 주석) 이 순서가 곧 규약이다.
    z._punch();
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
export function _punch(z) {
    const bones = z._punchBones;
    if (!bones?.length) return;
    // 시체에는 절대 걸지 않는다. `_groundOffset()` 이 "지금 자세에서 가장 낮은 뼈"를
    // 읽어 바닥에 붙이는데, 거기에 반동이 얹히면 시체가 뜨거나 묻힌다.
    if (z.state === 'DEAD' || !z._bend) return;

    const amp = z._bend * KNOCK.boneBend;
    const pitch = -amp * (z._flinchZ ?? 1);   // 맞은 방향으로 젖힌다
    const roll = amp * (z._flinchX ?? 0);     // 옆에서 맞으면 비틀린다
    for (let i = 0; i < bones.length; i++) {
      const w = z._punchW[i];
      if (!w) continue;
      _e.set(pitch * w, 0, roll * w);
      bones[i].quaternion.multiply(_q.setFromEuler(_e));
    }
}

  /**
   * 지금 자세에서 **가장 낮은 뼈**를 찾아, 그것이 바닥에 닿도록 내릴 양을 돌려준다.
   * 자세를 가리지 않으므로 어떤 사망 클립이 뽑혀도 통한다.
   * (Box3.setFromObject 는 스킨 메시의 실제 자세를 반영하지 않아 못 쓴다)
   */
export function _groundOffset(z) {
    if (!z.model) return 0;
    // 이 한 줄이 서브트리 전체의 matrixWorld 를 최신으로 만든다. 지우면 한 프레임
    // 늦은 자세로 접지해서 시체가 미세하게 떤다 — 순서가 곧 규약이다.
    z.group.updateMatrixWorld(true);
    let lowest = Infinity;
    // **getWorldPosition 을 쓰면 안 된다.** 내부에서 뼈마다 루트까지 부모 체인을
    // 다시 계산해서, 방금 위에서 구한 값을 뼈 65개 x 깊이 7 = 450여 번 다시 구한다.
    // 하필 웨이브에서 서너 마리가 동시에 쓰러지는, 프레임이 가장 빡빡한 순간에 겹친다.
    // 이미 최신인 matrixWorld 에서 위치만 읽는다. 뼈 목록도 부착 시 한 번만 모은다.
    const bones = z._bones;
    for (let i = 0; i < bones.length; i++) {
      _tmp.setFromMatrixPosition(bones[i].matrixWorld);
      if (_tmp.y < lowest) lowest = _tmp.y;
    }
    if (!Number.isFinite(lowest)) return 0;
    // 뼈는 살 안쪽에 있으므로 조금 띄워야 몸이 바닥에 파묻히지 않는다
    return z.group.position.y - lowest + CORPSE.restHeight;
}

