/**
 * WeaponAttack — 실제로 때리는 부분. 총 발사·히트스캔·벽 추적·근접 휘두름·투척.
 *
 * WeaponSystem 에서 갈라져 나왔다. 시스템 인스턴스가 첫 인자 `sys` 로 들어오고
 * 나머지 인자는 그대로다. WeaponSystem 에 같은 이름의 한 줄 위임이 남아 있어
 * **부르는 쪽은 안 바뀐다.**
 *
 * **인자 이름이 sys 인 이유** — 이 파일에는 z 좌표를 담는 지역변수 `z` 가 여럿 있다
 * (`for (const z of zombies)`, `const z = origin.z + ...`). 인스턴스를 `z` 로 받으면
 * 그 안쪽에서 조용히 가려져 **숫자에 대고 .collision 을 부르게 된다.** 실제로 한 번
 * 그렇게 만들었고, 빗나간 총알이 벽에 닿는 순간 터지는 상태였다.
 * **ESLint no-undef 로는 안 잡힌다** — 이름은 정의돼 있고 가리키는 대상만 틀리기 때문이다.
 *
 * 좀비 몸을 캡슐로 근사하는 판정(capsuleOf · rayVsSegment)도 여기로 같이 왔다 —
 * 쓰는 곳이 히트스캔과 근접 판정 둘뿐이라 여기 있는 편이 읽기 쉽다.
 */

import * as THREE from 'three';
import { MUZZLE, NOISE, WEAPON_SWING, WALL_IMPACT, AUDIO } from '../config/balance.js';
import { getCurve } from './SwingCurves.js';
import { bus, EV } from '../core/EventBus.js';

/**
 * 좀비 몸을 **선분 + 반지름**(캡슐)으로 근사한다.
 *
 * 서 있으면 세로로 서고, 엎드린 개체는 **바라보는 방향으로 눕는다.**
 * 전진 방향은 `(-sin(facing), -cos(facing))` — Zombie.js 의 규약과 같다.
 * 머리는 앞끝(s=1) 쪽이다.
 */
const _cap = { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, r: 0 };
function capsuleOf(z) {
  const d = z.def;
  if (d.crawler) {
    const half = (d.bodyLength ?? 1.4) * 0.5;
    const fx = -Math.sin(z.facing), fz = -Math.cos(z.facing);
    const y = z.pos.y + (d.hitY ?? d.height * 0.45);
    _cap.ax = z.pos.x - fx * half; _cap.ay = y; _cap.az = z.pos.z - fz * half;
    _cap.bx = z.pos.x + fx * half; _cap.by = y; _cap.bz = z.pos.z + fz * half;
    _cap.r = d.hitRadius ?? d.radius;
  } else {
    const r = d.hitRadius ?? d.radius;
    _cap.ax = z.pos.x; _cap.ay = z.pos.y + r; _cap.az = z.pos.z;
    _cap.bx = z.pos.x; _cap.by = z.pos.y + Math.max(d.height - r, r); _cap.bz = z.pos.z;
    _cap.r = r;
  }
  return _cap;
}

/**
 * 레이(origin + dir*t, t>=0)와 선분 AB 의 최근접.
 * @returns {{t:number, s:number, distSq:number}} t = 레이 위 거리, s = 선분 위 0~1 위치
 *
 * 선분 쪽 파라미터를 0~1 로 자른 뒤 레이 쪽을 다시 잡는다 — 한 번의 보정으로
 * 충분하다. 히트스캔은 정확한 최단거리가 아니라 "맞았는가"만 알면 된다.
 */
function rayVsSegment(o, dir, cap) {
  const ux = cap.bx - cap.ax, uy = cap.by - cap.ay, uz = cap.bz - cap.az;
  const wx = o.x - cap.ax, wy = o.y - cap.ay, wz = o.z - cap.az;
  const b = dir.x * ux + dir.y * uy + dir.z * uz;
  const c = ux * ux + uy * uy + uz * uz;
  const d = dir.x * wx + dir.y * wy + dir.z * wz;
  const e = ux * wx + uy * wy + uz * wz;
  const den = c - b * b;                      // |dir| = 1 이므로 a = 1
  let s = den > 1e-8 ? (e - b * d) / den : 0;
  s = s < 0 ? 0 : s > 1 ? 1 : s;
  const qx = cap.ax + ux * s, qy = cap.ay + uy * s, qz = cap.az + uz * s;
  let t = (qx - o.x) * dir.x + (qy - o.y) * dir.y + (qz - o.z) * dir.z;
  if (t < 0) t = 0;
  const px = o.x + dir.x * t - qx, py = o.y + dir.y * t - qy, pz = o.z + dir.z * t - qz;
  return { t, s, distSq: px * px + py * py + pz * pz };
}

  // ───────────────────────── 총기 ─────────────────────────
export function _fireGun(sys, def) {
    const a = sys.ammo[def.id];
    if (!a || a.mag <= 0) {
      bus.emit(EV.HINT, { text: '탄창 비어 있음 — R', duration: 1.2 });
      sys.cooldown = 0.35;
      if (a && a.reserve > 0) sys.reload();
      return;
    }
    a.mag--;
    sys.cooldown = def.cooldown;
    sys._recoil = 1;
    sys._muzzle = MUZZLE.duration;    // 총구 화염 — 한순간 복도 전체가 드러난다

    const origin = new THREE.Vector3().copy(sys.camera.position);
    const baseDir = new THREE.Vector3(0, 0, -1).applyQuaternion(sys.camera.quaternion);
    const spread = def.spread * (sys.aiming ? 0.45 : 1);

    // 벽 탄흔은 **한 발에 한 번만** 찾는다. 추적 한 번이 150스텝 x 충돌박스 전체라,
    // 산탄(7발)이 전부 빗나가면 같은 계산을 일곱 번 하게 된다. 눈으로도 같은 자리에
    // 먼지가 일곱 겹으로 쌓여 오히려 나빠진다 — 한 번이 맞다.
    sys._tracedThisShot = false;
    for (let p = 0; p < (def.pellets ?? 1); p++) {
      const dir = baseDir.clone();
      dir.x += (Math.random() - 0.5) * spread * 2;
      dir.y += (Math.random() - 0.5) * spread * 2;
      dir.z += (Math.random() - 0.5) * spread * 2;
      dir.normalize();
      sys._hitscan(origin, dir, def.range, def.damage, 0.35);
    }

    bus.emit(EV.SFX, { name: 'pistol_fire', volume: def.silenced ? 0.35 : 1 });
    bus.emit(EV.NOISE, {
      x: sys.player.pos.x, z: sys.player.pos.z,
      radius: NOISE[def.noise] ?? NOISE.gunshot, source: 'gunshot',
    });
    bus.emit(EV.WEAPON_FIRED, { weapon: def });
    sys._emitAmmo();
}

  /**
   * 레이 위에서 가장 가까운 좀비를 찾는다 (**캡슐** 근사).
   *
   * 예전에는 구 하나였다. 서 있는 개체는 그럭저럭 맞았지만 **엎드린 개체는
   * 골반 둘레만 판정돼서, 머리나 다리를 조준하면 그대로 빗나갔다** —
   * 포복체 몸은 1.45m 가로로 누워 있는데 구의 반지름은 0.54m 였다.
   * 이제 몸을 선분으로 두고 그 둘레를 판정한다. 서 있으면 세로, 엎드리면
   * **바라보는 방향으로** 눕는다.
   */
export function _hitscan(sys, origin, dir, range, damage, stun) {
    const zombies = sys.getZombies();
    let best = null, bestT = range, bestS = 0;

    for (const z of zombies) {
      if (!z.active || z.state === 'DEAD') continue;
      const cap = capsuleOf(z);
      const r = cap.r + 0.12;
      const hit = rayVsSegment(origin, dir, cap);
      if (hit.t < 0 || hit.t > bestT) continue;
      if (hit.distSq > r * r) continue;
      // 벽 뒤면 무효
      if (sys.collision.segmentBlocked(origin.x, origin.z, z.pos.x, z.pos.z)) continue;
      best = z; bestT = hit.t; bestS = hit.s;
    }

    if (best) {
      // 엎드린 몸은 머리가 **앞끝**에 있다. 서 있으면 위쪽이다.
      const headshot = best.def.crawler
        ? bestS > WEAPON_SWING.meleeHeadS
        : (origin.y + dir.y * bestT) > best.pos.y + best.def.height * 0.78;
      best.hit(damage * (headshot ? 2.2 : 1), stun, headshot, origin);
      return;
    }
    // 아무도 못 맞혔으면 **세상 어딘가에는 맞았다.** 지금까지는 총구 화염 0.065초
    // 말고는 아무 일도 안 일어나서, 칠흑 속에서 조준이 맞았는지 알 단서가 없었다.
    sys._traceWorld(origin, dir);
}

  /**
   * 빗나간 총알이 벽·바닥·천장 어디에 박혔는지 찾는다.
   *
   * Collision 은 XZ 전용 AABB 라 3D 레이 교차가 없다. 그래서 일정 간격으로
   * 전진시키며 막히는 첫 지점을 잡는다 — **간격이 벽 두께(0.2m)보다 작아야 한다.**
   * 사거리를 끊는 이유는 비용이다: 권총 사거리 60m 를 그대로 훑으면 500회가 되는데,
   * 그 너머 탄흔은 어차피 화면에 안 보인다.
   */
export function _traceWorld(sys, origin, dir) {
    if (sys._tracedThisShot) return;     // 산탄 한 발에 한 번 (위 `_fireGun` 주석)
    sys._tracedThisShot = true;
    const step = WALL_IMPACT.step;
    const n = Math.ceil(WALL_IMPACT.maxRange / step);
    let px = origin.x, py = origin.y, pz = origin.z;
    for (let i = 1; i <= n; i++) {
      const x = origin.x + dir.x * step * i;
      const y = origin.y + dir.y * step * i;
      const z = origin.z + dir.z * step * i;
      let nx = 0, ny = 0, nz = 0;
      if (y <= 0) { ny = 1; }                              // 바닥
      else if (y >= WALL_IMPACT.ceilingHeight) { ny = -1; }   // 천장
      else if (sys.collision.isBlocked(x, z, 0.02)) {
        // 벽 법선은 진행 방향의 반대로 근사한다. 어느 면인지까지 알 필요는 없다 —
        // 먼지가 튀어나오는 방향만 그럴듯하면 된다.
        nx = -dir.x; nz = -dir.z;
        const l = Math.hypot(nx, nz) || 1;
        nx /= l; nz /= l;
      } else { px = x; py = y; pz = z; continue; }

      bus.emit(EV.WALL_HIT, { x: px, y: Math.max(py, 0.02), z: pz, nx, ny, nz });
      // 소리는 기존 둔기 타격음을 빠르게 돌려 쓴다 — 재생속도를 올리면 짧고
      // 딱딱한 '틱' 이 되어 콘크리트 파편음 대역에 들어온다. 3D 경로를 그대로
      // 타므로 거리 감쇠·패닝·저역통과가 공짜로 붙는다.
      bus.emit(EV.SFX, {
        name: `hit_blunt_${1 + ((Math.random() * 2) | 0)}`,
        x: px, z: pz,
        volume: WALL_IMPACT.sfxVolume, rate: WALL_IMPACT.sfxRate,
      });
      return;
    }
}

  // ───────────────────────── 근접 ─────────────────────────
  /**
   * 스윙을 **시작만** 한다. 판정은 무기가 가장 뻗는 순간에 `_resolveMelee` 가 한다.
   *
   * 예전에는 이 함수가 클릭한 그 프레임에 판정까지 끝냈다. 그런데 뷰모델이 가장
   * 뻗는 시점은 스윙의 54% 지점(쇠파이프 기준 0.258초 뒤)이라, **화면에서는 아직
   * 쉬는 자세인데 좀비가 이미 피를 뿜고 젖혀졌다.** 히트스톱까지 그 시점에 걸려서
   * "클릭 → 정지 → 그제서야 휘두름" 순서가 됐다.
   * 좀비 쪽은 `ATTACK.contact` 로 이미 해결한 문제인데 플레이어 쪽만 남아 있었다.
   *
   * 쿨다운은 여기서 그대로 걸리므로 **연타 리듬은 1프레임도 안 바뀐다.**
   */
export function _swingMelee(sys, def) {
    sys.cooldown = def.cooldown;
    // 시간 기반 스윙. 예비동작 → 타격 → 마무리 순서가 있어야 "휘둘렀다"로 읽힌다
    sys._swingT = 0;
    sys._swingDur = Math.min(def.cooldown * 0.92, 0.62);
    sys._swingDir = -sys._swingDir;        // 좌우 번갈아 휘두른다
    sys._impact = 0;                        // 지난 스윙의 반발이 남아 있으면 궤적이 끊긴다
    // 궤적도 번갈아 쓴다 — 같은 곡선만 반복하면 사람이 휘두르는 느낌이 도로 사라진다
    sys._swingCurve = getCurve(sys._swingDir > 0
      ? 'standing_melee_attack_downward'
      : 'standing_melee_attack_backhand');
    // 휘두르는 소리는 여기서 내지 않는다. 클릭 순간은 무기가 아직 **뒤로 당겨지는**
    // 중이라 바람 소리가 동작보다 먼저 났다. 뷰모델이 타격 구간에 들어갈 때 낸다
    // (WEAPON_SWING.whooshAt).
    sys._whooshDone = false;

    // 기합 — **매번 내면 3분 만에 견딜 수 없어진다.** 확률로 거르고 쿨다운을 건다.
    // 연타 중에도 이따금씩만 나야 "힘을 준 한 번"으로 읽힌다.
    // 시간 기준은 `_idle` 을 쓴다 — 뷰모델이 매 프레임 dt 를 더하는 초 단위 시계다.
    // 스윙 **횟수**로 세면 안 된다. "1회 이상 간격"은 두 번째 스윙부터 늘 참이라
    // 쿨다운이 아예 없는 것과 같아진다 (한 번 그렇게 썼다).
    const V = AUDIO.voice;
    const now = sys._idle ?? 0;
    if (Math.random() < V.effortChance && now - (sys._lastEffortAt ?? -999) >= V.effortCooldown) {
      sys._lastEffortAt = now;
      bus.emit(EV.SFX, {
        name: `player_effort_${1 + ((Math.random() * V.effortVariants) | 0)}`,
        volume: V.effortVolume,
      });
    }

    // 판정을 접촉 시점으로 예약한다. 상한을 두는 이유는 쿨다운이 긴 무기에서
    // 클릭이 씹힌 느낌이 나지 않게 하기 위해서다.
    sys._meleePending = def;
    sys._meleeAt = Math.min(
      sys._swingDur * WEAPON_SWING.contact, WEAPON_SWING.contactMaxDelay);
}

  /**
   * 실제 판정. **접촉 시점의 시선·위치**를 쓴다 — 휘두르는 도중 몸을 돌리면
   * 빗나간다. 좀비 공격과 같은 규칙이 되는 것이라 이쪽이 맞다.
   */
export function _resolveMelee(sys, def) {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(sys.camera.quaternion);
    /**
     * **바닥을 내려다보면 근접 공격이 통째로 빗나가던 버그** (2026-08-07 수정)
     *
     * 판정은 바닥에 눕힌 부채꼴(위에서 본 각도)인데, 비교 대상인 `fwd` 는
     * 카메라의 **3D** 전방이라 수평 길이가 `cos(고개각)` 만큼 짧다.
     * 그래서 고개를 숙일수록 내적이 통째로 줄고, 정면으로 딱 겨눠도
     * `halfArc` 문턱을 못 넘는다. 각도가 좁은 무기일수록 먼저 죽는다:
     *
     *   쇠파이프(70°) → 35° 아래 · 소방도끼(55°) → **27.5° 아래면 무조건 빗나감**
     *
     * 기는 좀비는 눈높이 1.55m 에서 1.2m 앞이면 이미 46° 아래다.
     * 즉 **기는 좀비는 근접으로 아예 죽일 수 없었다.** 총은 캡슐 레이라 멀쩡했으므로
     * "가끔 좀비가 안 죽는다"로 보였다.
     *
     * 고개각은 부채꼴 판정에 들어가면 안 된다 — 수평 성분만 뽑아 다시 정규화한다.
     */
    const fwdLen = Math.hypot(fwd.x, fwd.z) || 1;
    const fx = fwd.x / fwdLen, fz = fwd.z / fwdLen;
    const halfArc = Math.cos(THREE.MathUtils.degToRad(def.arcDeg) / 2);
    const zombies = sys.getZombies();
    let hitAny = false;

    for (const z of zombies) {
      if (!z.active || z.state === 'DEAD') continue;
      const dx = z.pos.x - sys.player.pos.x;
      const dz = z.pos.z - sys.player.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > def.range + z.def.radius) continue;
      // 발밑에 딱 붙은 개체는 방향이 무의미하다 — 나누면 0으로 나뉘어 판정이 튄다
      const close = dist < 1e-3;
      const dot = close ? 1 : (dx / dist) * fx + (dz / dist) * fz;
      if (dot < halfArc) continue;
      // **벽 너머는 못 때린다.** 총은 이미 이 규칙을 지키는데(_hitscan) 근접만
      // 빠져 있어서, 문 하나 사이에 두고 붙은 좀비를 쇠파이프로 때릴 수 있었다.
      if (sys.collision.segmentBlocked(
        sys.player.pos.x, sys.player.pos.z, z.pos.x, z.pos.z)) continue;

      // 근접에도 머리 판정이 있다. 예전에는 세 번째 인자가 **항상 false 하드코딩**이라
      // 도끼로 머리를 찍어도 정강이를 친 것과 데미지·소리·피가 전부 같았다.
      // 발밑에 붙은 개체는 레이가 튀므로 판정하지 않는다.
      let headshot = false;
      if (!close) {
        const cap = capsuleOf(z);
        const h = rayVsSegment(sys.camera.position, fwd, cap);
        headshot = h.distSq <= (cap.r + 0.12) ** 2 && h.s > WEAPON_SWING.meleeHeadS;
      }
      // 팔에 힘이 빠진다 — 다칠수록 근접이 약해진다 (Player.meleeMul)
      const mul = sys.player.meleeMul ?? 1;
      // 날붙이는 살을 가르는 소리, 둔기는 뼈 소리. 예전에는 소방도끼와 쇠파이프가
      // 완전히 같은 소리를 냈다 (weapons.js 의 `blade` 표시를 읽는다)
      z.hit(def.damage * mul * (headshot ? 2.2 : 1), def.stun * mul, headshot,
        sys.player.pos, def.blade ? 'blade' : 'blunt');
      hitAny = true;
    }

    // 닿았을 때만 화면이 걸린다. 헛스윙에도 흔들리면 타격의 의미가 사라진다
    if (hitAny) {
      sys._impact = 1;                      // 무기가 그 자리에서 걸렸다가 튕겨 돌아온다
      bus.emit(EV.MELEE_HIT, { x: sys.player.pos.x, z: sys.player.pos.z });
    } else {
      // 아무도 못 맞혔으면 **벽을 쳤는지** 본다. 지금까지는 벽이라는 개념이
      // 근접에 아예 없어서 무기가 벽을 관통해 그냥 지나갔다.
      // Collision 은 2D AABB 라 높이를 모른다 — 벽으로 등록된 박스만 잡힌다.
      //
      // **끝점 하나만 보면 안 된다.** 벽 두께가 0.2m 라 0.85 x 사거리(1.45m) 지점은
      // 벽을 통째로 지나쳐 버린다 — 실측에서 벽 앞 0.75m 에 서서 휘둘렀는데
      // 한 번도 안 잡혔다. 무기가 지나가는 경로를 **훑어야** 한다.
      const px = sys.player.pos.x + fx * def.range * WEAPON_SWING.wallProbe;
      const pz = sys.player.pos.z + fz * def.range * WEAPON_SWING.wallProbe;
      if (sys.collision.segmentBlocked(
        sys.player.pos.x, sys.player.pos.z, px, pz, WEAPON_SWING.wallProbeStep)) {
        sys._impact = 1;
        bus.emit(EV.MELEE_CLANG, { x: px, z: pz });
      }
    }

    // 타격음은 Zombie.hit() 이 부위·무기별로 낸다 (여기서 또 내면 겹친다)
    bus.emit(EV.NOISE, {
      x: sys.player.pos.x, z: sys.player.pos.z,
      radius: NOISE.melee, source: 'melee',
    });
}

  // ───────────────────────── 투척 ─────────────────────────
export function _throw(sys, def) {
    sys.cooldown = def.cooldown;
    sys._swing = 1;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(sys.camera.quaternion);
    const tx = sys.player.pos.x + fwd.x * 9;
    const tz = sys.player.pos.z + fwd.z * 9;

    if (def.lure) {
      // 라디오 — 좀비를 그쪽으로 유인한다 (전투 회피 도구)
      bus.emit(EV.NOISE, { x: tx, z: tz, radius: def.lureRadius, source: 'lure' });
      bus.emit(EV.HINT, { text: '라디오를 던졌다', duration: 1.6 });
    } else {
      for (const z of sys.getZombies()) {
        if (!z.active || z.state === 'DEAD') continue;
        const d = Math.hypot(z.pos.x - tx, z.pos.z - tz);
        if (d <= def.radius) z.hit(def.damage, 0.5, false, { x: tx, z: tz });
      }
      bus.emit(EV.NOISE, { x: tx, z: tz, radius: NOISE.melee, source: 'throw' });
    }
}
