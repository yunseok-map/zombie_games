/**
 * ZombieCombat — 피격·사망 처리와 공격 사이클(선딜 → 닿음 → 물기).
 *
 * Zombie.js 에서 갈라져 나왔다. 개체가 첫 인자(z)로 들어오고 나머지는 그대로다.
 * Zombie 클래스에 같은 이름의 한 줄 위임이 남아 있어 **부르는 쪽은 안 바뀐다**
 * (hit 은 WeaponSystem 이 부르는 공개 메서드다).
 *
 * 여기 수치의 근거는 대부분 실측이다 — 주석의 값을 감으로 고치지 마라.
 */

import * as THREE from 'three';
import { KNOCK, CORPSE, ATTACK, GRAB, DEATH, ANIM } from '../config/balance.js';
import { bus, EV } from '../core/EventBus.js';

  /**
   * @param from 때린 쪽의 위치 {x,z}. 주면 그 방향으로 밀리고 젖혀진다 —
   *   어디서 맞았든 똑같이 뒤로 젖혀지면 타격이 "닿았다"는 느낌이 안 난다.
   */
export function hit(z, damage, stun = 0, headshot = false, from = null, kind = 'blunt') {
    if (!z.active || z.state === 'DEAD') return;
    z.hp -= damage;
    z.stun = Math.max(z.stun, stun / (z.def.stunResist || 1));
    if (headshot) z.stun += 0.15;
    // 플린치는 연출 전용 — AI 를 멈추지 않는다. 스턴이 0인 총알도 움찔하게 만든다.
    z._flinchTotal = Math.max(0.42, z.stun);
    z.flinch = z._flinchTotal;

    /**
     * 데미지가 반응 **크기**에 들어간다 (시간이 아니다 — 시간을 늘리면 AI 가 멈춘 것처럼
     * 보인다). 예전에는 권총 1발과 도끼 한 방이 픽셀 단위로 똑같이 움찔했다.
     * 플린치가 진행 중이면 더한다 — 같은 프레임에 여러 발이 박히면 자연히 합산된다.
     * **밀림(KNOCK.distance)에는 절대 곱하지 않는다.** 밀림을 키우면 무게가 사라지고
     * 그것만 눈에 띈다 (0.34 → 0.18 로 줄인 기록이 balance.js 에 있다).
     */
    const add = damage / KNOCK.powerRef;
    z._flinchPower = Math.min(KNOCK.powerMax,
      Math.max(KNOCK.powerMin, (z.flinch > 0 ? (z._flinchPower ?? 0) : 0) + add));

    // 같은 프레임에 여러 발이 들어와도 되감기는 한 번만 — 연달아 reset 하면
    // 클립이 첫 프레임에 고정돼 **완전히 멈춘 것처럼 보인다.**
    if ((z._sinceHit ?? 99) >= ANIM.hitRetriggerMin) {
      z._hitRestart = true;
      // 맞을 때마다 반응 클립을 새로 뽑는다. 고정해 두면 한 마리가 평생 같은
      // 동작으로만 움찔한다 — 파일에는 3종이 들어 있는데 로드 시점에 얼어붙었다.
      // 지금 그 클립을 재생 중이면 건드리지 않는다(재생 중 교체는 자세가 튄다).
      if (z.curAnim !== z.actions?.hit) z._roll?.('hit');
    }
    z._sinceHit = 0;

    // 넉백·젖힘 방향. 위치는 건드리지 않고 **보이는 것만** 민다 —
    // 실제 좌표를 밀면 벽을 뚫거나 경로가 꼬인다.
    let kx = 0, kz = 1;
    if (from) {
      kx = z.pos.x - from.x; kz = z.pos.z - from.z;
      const L = Math.hypot(kx, kz) || 1;
      kx /= L; kz /= L;
    }
    z._knockX = kx; z._knockZ = kz;
    z._knockT = KNOCK.duration * (headshot ? 1.25 : 1)
      * (1 + Math.min(1, stun)) / (z.def.stunResist || 1);
    z._knockTotal = z._knockT;
    // 맞은 방향을 좀비 기준으로 분해한다 — 앞뒤 성분은 젖힘, 좌우 성분은 비틀림.
    // 전진 방향은 (-sin, -cos) 이고(파일 상단 MODEL_YAW 주석), 오른쪽은 그것과 직교하는
    // (cos, -sin) 이다. 회전행렬을 그대로 쓰면 축이 어긋나 옆에서 맞아도 뒤로 젖혀진다.
    const sf = Math.sin(z.facing), cf = Math.cos(z.facing);
    z._flinchZ = kx * -sf + kz * -cf;   // +면 앞으로 밀림 = 뒤에서 맞았다
    z._flinchX = kx * cf + kz * -sf;    // +면 오른쪽으로 밀림

    // 피격음 — 날붙이는 살을 가르는 소리, 둔기(스턴 큼)는 뼈 소리,
    // 총알은 살점 소리, 헤드샷은 따로.
    // `melee_hit`(sfx_axe_hit_flesh.mp3)은 등록만 되고 두 세션 동안 한 번도
    // 재생되지 않았다 — 소방도끼와 쇠파이프가 완전히 같은 소리를 내고 있었다.
    const impact = headshot ? 'hit_headshot'
      : kind === 'blade' ? 'melee_hit'
        : stun >= 0.8 ? `hit_blunt_${1 + ((Math.random() * 2) | 0)}`
          : `hit_flesh_${1 + ((Math.random() * 2) | 0)}`;
    bus.emit(EV.SFX, { name: impact, x: z.pos.x, z: z.pos.z, volume: 0.95 });
    // 맞은 자리에서 피가 튄다. 머리를 맞았으면 더 높은 곳에서, 더 많이.
    // headshot 을 불리언으로 같이 보낸다 — HUD 마커와 화면흔들림이 읽는다.
    // power 값(1.8)으로 구분하게 하면 HUD 에 매직넘버가 생긴다.
    bus.emit(EV.ZOMBIE_HIT, {
      x: z.pos.x,
      y: z.def.height * (headshot ? 0.86 : 0.62),
      z: z.pos.z,
      nx: kx, nz: kz,
      power: headshot ? 1.8 : 1,
      headshot,
    });

    if (z.hp <= 0) {
      z.state = 'DEAD';
      z.deathTimer = CORPSE.linger;
      // 쓰러지는 자세도 매번 새로 뽑는다 — 고정하면 한 마리가 늘 같은 자세로 죽는다
      z._roll?.('death');
      // 클립 길이가 3.00~4.97초로 제각각이라 상수 배속을 쓰면 쓰러지는 시간이
      // 1.8초와 3.0초로 갈린다. **걸리는 시간**을 맞추고 배속을 역산한다.
      // **지터는 clamp 안에서 곱한다** — 밖에서 곱하면 상한을 걸어 놓고 그 위를
      // 넘긴다. 이 프로젝트가 걷기·공격에서 이미 두 번 밟은 함정이고,
      // tools/qa_motion.js 의 배속 검사가 존재하는 이유가 바로 이것이다.
      const dClip = z.actions?.death?.getClip?.().duration ?? 1.5;
      z._deathSpeed = THREE.MathUtils.clamp(
        (dClip / CORPSE.deathTargetSec) * z._jitter,
        CORPSE.deathSpeedMin, CORPSE.deathSpeedMax);
      // 바닥 고정 시점을 **클립 길이에서 구한다.** 고정값(예전 1.6초)을 쓰면 3초짜리
      // 사망 클립이 아직 움직이는 중에 위치가 잠겨서 뼈가 바닥을 뚫고 내려갔다.
      z._settleAt = dClip / z._deathSpeed + CORPSE.settleMargin;
      z._thudDone = false;
      // 죽는 순간이 평타와 거의 구별되지 않았다 — 죽음 소리가 피격음(0.95)보다
      // **오히려 조용했고**, 사망 전용 버스트가 없었다. 크고 밝게 한 번 더 터뜨린다.
      // **`headshot` 이 아니라 `hot` 이다.** headshot 은 생김새만 바꾸는 값이 아니라
      // 의미 플래그다 — Player 가 헤드샷 전용 화면흔들림을, HUD 가 헤드샷 히트마커를
      // 같이 읽는다. 여기에 true 를 넣으면 **몸통을 쳐서 죽여도 매번 헤드샷 반동**이
      // 오고, 머리를 한 번도 안 맞혔는데 헤드샷 마커가 번쩍인다.
      // 사망 버스트에 필요한 것은 "크고 밝고 높이"뿐이므로 hot 만 켠다.
      bus.emit(EV.ZOMBIE_HIT, {
        x: z.pos.x, y: z.def.height * DEATH.burstY, z: z.pos.z,
        nx: kx, nz: kz, power: DEATH.burstPower, hot: true,
      });
      bus.emit(EV.SFX, {
        name: 'zombie_death', x: z.pos.x, z: z.pos.z, volume: DEATH.sfxVolume,
      });
      bus.emit(EV.ZOMBIE_DIED, { x: z.pos.x, z: z.pos.z, type: z.typeKey });
    } else if (z.state !== 'CHASE') {
      z.state = 'CHASE';
      bus.emit(EV.SFX, { name: 'zombie_alert', x: z.pos.x, z: z.pos.z, volume: 0.9 });
    }
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
export function _startSwing(z, delay = 0) {
    z._swingT = -delay;                       // 음수 구간이 예비동작이다
    z._swingHit = false;
    z._swingLen = z.def.attackCooldown;

    // 포복체는 엎드린 공격 클립이 없어 crawl 을 빠르게 돌린다(ANIM). 그 클립은
    // 이동에도 쓰이므로 스윙마다 되감으면 기는 동작이 뚝뚝 끊긴다 — 건드리지 않는다.
    const a = z.def.crawler ? null : z.actions?.attack;
    if (!a) { z._swingContact = z._swingLen * ATTACK.contactDefault; return; }

    const clip = a.getClip();
    // 한 번 휘두르는 시간을 쿨다운에 맞춘다. **상한을 걸어야 한다** — 4.5초짜리
    // 클립을 1.1초 쿨다운에 맞추면 4.5배속이 되어 팔이 경련한다.
    // 지터는 clamp 안에서 곱한다 (밖에서 곱하면 상한 2.0 을 걸어 놓고 2.16 이 나온다).
    const scale = THREE.MathUtils.clamp(
      (clip.duration / z._swingLen) * z._jitter,
      ANIM.attackMinSpeed, ANIM.attackMaxSpeed);
    a.timeScale = scale;
    a.reset().play();                            // **스윙마다 처음부터** — 위상이 안 어긋난다

    // 클립 안의 접촉 지점(0~1)을 실제 초로 바꾼다. 배속을 나눠야 한다.
    const f = ATTACK.contact[clip.name] ?? ATTACK.contactDefault;
    // 상한에 걸려 동작이 쿨다운보다 일찍 끝나면 접촉도 그만큼 앞당겨진다 — 그게 맞다.
    z._swingContact = Math.min((clip.duration * f) / scale, z._swingLen);
}

export function _attack(z, dt, player, dist, collision) {
    const dx = player.pos.x - z.pos.x, dz = player.pos.z - z.pos.z;
    z.facing = Math.atan2(-dx, -dz);

    if (dist > z.def.attackRange * 1.35) { z.state = 'CHASE'; return; }

    // 벽 너머로 때리지 못하게 한다. 거리만 보면 문틈·모서리를 사이에 두고도 맞는다.
    if (collision?.segmentBlocked(z.pos.x, z.pos.z, player.pos.x, player.pos.z)) {
      z.state = 'CHASE';
      return;
    }

    z._swingT += dt;

    // 팔이 가장 뻗은 그 프레임에 들어간다
    if (!z._swingHit && z._swingT >= z._swingContact) {
      z._swingHit = true;
      z._land(player);
    }

    if (z._swingT >= z._swingLen) z._startSwing();
}

  /** 타격이 닿은 순간 — 여기서만 데미지·소리·물림이 일어난다 */
export function _land(z, player) {
    bus.emit(EV.SFX, { name: 'zombie_attack', x: z.pos.x, z: z.pos.z, volume: 1 });
    z._hitstop = ATTACK.hitstop;      // 때린 쪽도 멈춘다. 한쪽만 멈추면 부딪힌 게 아니다

    // 물릴 것인가. **닿았을 때만** 판정한다 — 헛스윙에 물리면 억울하다.
    if (GRAB.enabled && player.canBeGrabbed?.() && Math.random() < GRAB.chance) {
      z.state = 'GRAB';
      player.beginGrab(z);
      bus.emit(EV.GRAB_START, { x: z.pos.x, z: z.pos.z });
      return;
    }
    player.damage(z.def.damage, z.pos);
}

  /**
   * 물고 있는 동안. 놓아주는 판단은 **Player 쪽이 한다** —
   * 뿌리치기 입력과 시간 초과를 한 곳에서 보는 편이 어긋날 여지가 없다.
   */
export function _grab(z, dt, player) {
    const dx = player.pos.x - z.pos.x, dz = player.pos.z - z.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    z.facing = Math.atan2(-dx, -dz);

    // 붙잡은 거리까지 끌어당긴다. 플레이어를 끄는 게 아니라 좀비가 파고든다 —
    // 플레이어 좌표를 건드리면 벽에 밀어넣을 수 있다.
    const want = GRAB.holdDistance;
    if (d > want) {
      const k = Math.min(1, (d - want) * dt * 6);
      z.pos.x += (dx / d) * (d - want) * k;
      z.pos.z += (dz / d) * (d - want) * k;
    }

    // 풀렸으면 돌아간다. (뿌리쳐진 경우의 경직은 onGrabBroken 이 따로 건다)
    if (player.grabbedBy !== z) z.state = 'CHASE';
}

  /** Player 가 뿌리쳤을 때 부른다 */
export function onGrabBroken(z) {
    z.stun = Math.max(z.stun, GRAB.releaseStun);
    z.state = 'CHASE';
    // 밀려나는 건 보이는 위치만 (좌표를 밀면 벽을 뚫는다 — KNOCK 과 같은 규약)
    z._knockT = z._knockTotal = KNOCK.duration;
    const s = Math.sin(z.facing), c = Math.cos(z.facing);
    z._knockX = s * GRAB.releasePush;
    z._knockZ = c * GRAB.releasePush;
}

