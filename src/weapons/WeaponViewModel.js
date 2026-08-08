/**
 * WeaponViewModel — 손에 든 무기의 생성과 매 프레임 움직임(휘두름·반동·재장전).
 *
 * WeaponSystem 에서 갈라져 나왔다. 시스템 인스턴스가 첫 인자(z)로 들어오고
 * 나머지 인자는 그대로다. (인자 이름이 z 인 것은 추출기가 붙인 것이다 — 좀비가 아니다)
 * WeaponSystem 에 같은 이름의 한 줄 위임이 남아 있어 **부르는 쪽은 안 바뀐다.**
 *
 * 휘두름 궤적은 절차적 사인 곡선이 아니라 사람 모션에서 뽑은 것이다 (SwingCurves).
 */

import * as THREE from 'three';
import { WEAPON_VIEW, WEAPON_SWING, WEAPON_RELOAD, SURFACE, MUZZLE, THROW_ANIM } from '../config/balance.js';
import { getCurve, sampleCurve } from './SwingCurves.js';
import { bus, EV } from '../core/EventBus.js';
import { WEAPON_MODELS, cloneWeaponGLB } from './ViewModels.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * 이징 — **모듈 최상단에 둔다.** 프레임 함수 안에 두면 초당 60개씩 클로저가 새로 생긴다.
 * 이 프로젝트는 이미 같은 이유로 Atmosphere 의 정렬 비교 함수를 밖으로 뺀 적이 있다.
 */
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeIn = (t) => t * t * t;
const easeInOut = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

export function _buildViewModel(z) {
    for (const m of z.viewParts) { z.viewRoot.remove(m); m.geometry?.dispose(); }
    z.viewParts.length = 0;
    // GLB 는 Group 이라 geometry 가 없다 — 옵셔널로 접근해야 한다
    if (z.viewMesh) { z.viewRoot.remove(z.viewMesh); z.viewMesh.geometry?.dispose(); z.viewMesh = null; }

    const def = z.current;

    // 1순위: CC0 GLB 모델
    const glb = cloneWeaponGLB(def.id);
    if (glb) {
      const v = WEAPON_VIEW[def.id] ?? { scale: 1, rot: [0, 0, 0], pos: [0, 0, 0] };
      glb.scale.setScalar(v.scale);
      glb.rotation.set(...v.rot);
      glb.position.set(...v.pos);
      glb.traverse((o) => {
        if (!o.isMesh) return;
        o.frustumCulled = false;
        // 손전등 코앞이라 원본 색 그대로면 하얗게 탄다
        o.material = o.material.clone();
        // 무기별 값이 있으면 그걸 쓴다 — 텍스처 있는 모델과 민무늬 모델은 기준이 다르다
        o.material.color.multiplyScalar(
          SURFACE.viewModelDim * (v.colorMul ?? WEAPON_VIEW.colorMul ?? 1));
      });
      z.viewRoot.add(glb);
      z.viewParts.push(glb);
      z.viewMesh = glb;
      return;
    }

    // 2순위: 절차적 모델
    const build = WEAPON_MODELS[def.id];
    if (build) {
      // 재질별로 묶어 병합 — 무기 하나가 드로우콜 4~5개를 넘지 않게 한다
      const byMat = new Map();
      for (const { mat, geo } of build()) {
        if (!byMat.has(mat)) byMat.set(mat, []);
        byMat.get(mat).push(geo);
      }
      for (const [key, geos] of byMat) {
        const merged = geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
        if (geos.length > 1) for (const g of geos) g.dispose();
        if (!merged) continue;
        const m = new THREE.Mesh(merged, z.viewMats[key] ?? z.viewMats.dark);
        m.frustumCulled = false;      // 카메라 자식이라 컬링 판정이 어긋난다
        z.viewRoot.add(m);
        z.viewParts.push(m);
      }
      z.viewMesh = z.viewParts[0] ?? null;   // 애니메이션 코드가 참조한다
      return;
    }

    // 모델이 없는 무기는 예전처럼 박스로 대체한다 (CLAUDE.md §1-2 — 없어도 돌아가야 한다)
    const s = def.viewScale ?? [0.08, 0.1, 0.4];
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(def.viewColor ?? 0x555555).multiplyScalar(SURFACE.viewModelDim),
      roughness: 0.55, metalness: 0.75,
    });
    z.viewMesh = new THREE.Mesh(new THREE.BoxGeometry(s[0], s[1], s[2]), mat);
    z.viewMesh.position.z = -s[2] / 2;
    z.viewRoot.add(z.viewMesh);
    z.viewParts.push(z.viewMesh);
}

  /**
   * 뷰모델 애니메이션.
   * 손맛의 대부분은 모델이 아니라 여기서 나온다 —
   * 예비동작 · 궤적 · 마무리, 그리고 시선을 돌릴 때 무기가 뒤따라오는 관성.
   */
export function _animateViewModel(z, dt, input) {
    z._recoil = Math.max(0, z._recoil - dt * 7);

    // 총구 화염은 아주 짧게, 그리고 세기를 조금씩 흔든다 (매번 같으면 스트로브처럼 보인다)
    if (z._muzzle > 0) {
      z._muzzle = Math.max(0, z._muzzle - dt);
      const k = z._muzzle / MUZZLE.duration;
      z.muzzleLight.intensity = MUZZLE.intensity * k * k * (0.82 + Math.random() * 0.36);
    } else if (z.muzzleLight.intensity !== 0) {
      z.muzzleLight.intensity = 0;
    }

    z._idle += dt;
    const sp = z.player.speed;
    z._bob += dt * (sp > 0.5 ? 8.5 : 0);

    // 접촉 반발 — 닿은 자리에서 멎었다가 손 쪽으로 튕겨 돌아온다.
    // 이게 없으면 살을 치든 허공을 치든 궤적이 100% 같아서, 화면이 흔들려도
    // "부딪혔다"가 아니라 "휘두르는 중에 화면이 흔들렸다"로 읽힌다.
    if (z._impact > 0) {
      z._impact = Math.max(0, z._impact - dt * WEAPON_SWING.impactDecay);
    }

    // ── 스윙: 예비동작(0~24%) → 타격(24~54%) → 마무리(54~100%) ──
    let wind = 0, arc = 0;
    if (z._swingT < z._swingDur) {
      // 닿는 순간 진행이 느려진다 — 무기가 그 자리에서 걸린다
      z._swingT += dt * (1 - WEAPON_SWING.impactSlow * z._impact);
      // 무기가 가장 뻗는 순간에 판정이 들어간다 (예약은 _swingMelee 가 건다)
      if (z._meleePending && z._swingT >= z._meleeAt) {
        const d = z._meleePending;
        z._meleePending = null;
        z._resolveMelee(d);
      }
      // 휘두르는 소리 — 무기가 가장 빠른 타격 구간에서. 클릭 순간에 내면
      // 아직 뒤로 당기는 중에 바람 소리가 먼저 난다 (그렇게 돼 있었다).
      if (!z._whooshDone && z._swingT >= z._swingDur * WEAPON_SWING.whooshAt) {
        z._whooshDone = true;
        bus.emit(EV.SFX, { name: 'melee_swing', volume: 0.6 });
      }

      const W = WEAPON_SWING;
      const p = Math.min(1, z._swingT / z._swingDur);
      const w = p < W.windEnd ? p / W.windEnd : 1;
      const strike = p < W.windEnd ? 0 : Math.min(1, (p - W.windEnd) / W.strikeSpan);
      const rec = p < W.recStart ? 0 : (p - W.recStart) / (1 - W.recStart);
      // 따라 나감 — 피크를 조금 넘겼다가 돌아온다. 정확히 1.0 에서 멎으면
      // 무기가 허공에서 브레이크를 밟은 것처럼 보인다.
      arc = easeIn(strike) * (1 + W.followThrough * strike)
          * (1 - easeInOut(Math.min(1, rec)));
      wind = easeOut(w) * (1 - strike);
    }

    /**
     * ── 던지기: 예비(0~32%) → 방출(32~44%) → 마무리 ──
     *
     * 휘두르기와 리듬이 다르다. 뒤로 크게 당겼다가 앞으로 뿌리고, **손을 떠난 뒤에는
     * 빈손이 보인다.** 그전까지는 이 구간이 통째로 없어서 뷰모델 진폭이 정확히 0 이었다
     * (실측: 쇠파이프 회전 1.66rad vs 화염병 0.00). 병을 든 채로 병이 앞에 생겼다.
     */
    let tWind = 0, tThrow = 0;
    if (z._throwT < z._throwDur) {
      z._throwT += dt;
      const T = THROW_ANIM;
      const p = Math.min(1, z._throwT / z._throwDur);
      // 병이 손을 떠나는 순간에 실제로 날린다 (근접이 접촉 시점에 판정하는 것과 같다)
      if (z._throwPending && p >= T.release) z._releaseThrow();
      tWind = p < T.windEnd
        ? easeOut(p / T.windEnd)
        : Math.max(0, 1 - (p - T.windEnd) / 0.10);
      const fwd = p < T.windEnd ? 0 : easeIn(Math.min(1, (p - T.windEnd) / (1 - T.windEnd)));
      const back = easeInOut(Math.max(0, Math.min(1, (p - T.release) / (1 - T.release))));
      tThrow = fwd * (1 - back);
      // 손을 떠난 뒤에는 **빈손**이다. 남은 개수가 있으면 끝에서 다시 든다 —
      // 없으면 끝까지 안 든다(아래에서 근접으로 바꾼다).
      const gone = p >= T.release && (p < T.showAgain || z._emptyAfterThrow);
      if (z.viewMesh) z.viewMesh.visible = !gone;
      // 동작이 방금 끝났다 — 마지막 하나였으면 여기서 손을 비운다
      if (z._throwT >= z._throwDur && z._emptyAfterThrow) {
        z._emptyAfterThrow = false;
        z._autoSwitchFromEmpty();
      }
    } else if (z.viewMesh && !z.viewMesh.visible) {
      z.viewMesh.visible = true;      // 무기를 바꿔도 숨은 채로 남지 않게
    }

    // ── 스윙에 시점이 따라간다 ──
    // 무기만 84도를 휘두르고 카메라가 1도도 안 움직이면 "손만 움직이는 유령"이 된다.
    // Player 가 카메라를 조립하므로 여기서는 값만 건네준다. Player.update 가 먼저
    // 돌기 때문에 한 프레임(16ms) 늦게 반영되는데, 스윙이 480ms 라 보이지 않는다.
    if (z.player) {
      const W = WEAPON_SWING, d = z._swingDir;
      const A = THROW_ANIM;
      z.player.swingLook = {
        pitch: wind * W.camWindPitch + arc * W.camArcPitch
          + tWind * A.camWindPitch + tThrow * A.camThrowPitch,
        yaw: arc * W.camArcYaw * d,
        roll: arc * W.camArcRoll * d + tThrow * A.camThrowRoll,
      };
    }
    z._swing = arc;
    const dir = z._swingDir;

    // ── 사람이 휘두른 궤적 ──
    // 절차적 사인 곡선은 가감속이 일정해서 "기계가 돈다"로 보인다.
    // 실제 모션에서 뽑은 곡선을 섞으면 예비동작에서 뜸을 들이고 타격에서 확 빠진다.
    // 곡선 파일이 없으면 전부 0 이라 기존 절차적 스윙만 남는다 (폴백).
    let cpx = 0, cpy = 0, cpz = 0, crx = 0, cry = 0, crz = 0;
    if (WEAPON_SWING.enabled) {
      const melee = z._swingT < z._swingDur && z._swingCurve;
      const gun = z._recoil > 0.001 ? getCurve('shooting') : null;
      if (melee) {
        const s = sampleCurve(z._swingCurve, z._swingT / z._swingDur);
        const ps = WEAPON_SWING.posScale * WEAPON_SWING.blend;
        const rs = WEAPON_SWING.rotScale * WEAPON_SWING.blend;
        cpx = s.p[0] * ps * dir; cpy = s.p[1] * ps; cpz = s.p[2] * ps;
        crx = s.e[0] * rs;       cry = s.e[1] * rs * dir; crz = s.e[2] * rs * dir;
      } else if (gun) {
        // 반동은 곡선의 앞부분만 쓴다 — 총은 휘두르는 게 아니라 튀었다가 돌아온다
        const s = sampleCurve(gun, (1 - z._recoil) * 0.5);
        cpx = s.p[0] * WEAPON_SWING.gunPosScale; cpy = s.p[1] * WEAPON_SWING.gunPosScale;
        cpz = s.p[2] * WEAPON_SWING.gunPosScale;
        crx = s.e[0] * WEAPON_SWING.gunRotScale; cry = s.e[1] * WEAPON_SWING.gunRotScale;
        crz = s.e[2] * WEAPON_SWING.gunRotScale;
      }
    }

    // ── 마우스 관성: 시선을 돌리면 무기가 반대로 밀렸다가 따라온다 ──
    const swayMul = z.player.swayMul ?? 1;
    if (input) {
      z._swayX += (-input.mouseDX * 0.0016 * swayMul - z._swayX) * Math.min(1, 14 * dt);
      z._swayY += (-input.mouseDY * 0.0014 * swayMul - z._swayY) * Math.min(1, 14 * dt);
    }
    z._swayX *= 1 - Math.min(1, 6 * dt);
    z._swayY *= 1 - Math.min(1, 6 * dt);
    const sx = THREE.MathUtils.clamp(z._swayX, -0.09, 0.09);
    const sy = THREE.MathUtils.clamp(z._swayY, -0.07, 0.07);

    // ── 걷기 흔들림 + 숨쉬기 ──
    const spN = Math.min(1, sp / 3);
    const bobX = Math.sin(z._bob) * 0.014 * spN;
    const bobY = Math.abs(Math.cos(z._bob)) * 0.012 * spN;
    const breath = Math.sin(z._idle * 1.5) * 0.004 * (1 - spN) * swayMul;

    // ── 정조준 ──
    const aimX = z.aiming ? -0.26 : 0;
    const aimY = z.aiming ? 0.09 : 0;
    const aimZ = z.aiming ? 0.08 : 0;

    // ── 재장전 동작 ── 총을 내렸다가 올린다. 0 → 1 → 0 으로 한 번 부푼다.
    // 진행률을 재장전 **남은 시간**에서 뽑으므로 무기마다 길이가 알아서 맞는다
    // (권총 1.6초 · 못총 2.1초 · 산탄총은 한 발당 0.55초씩 반복).
    let rl = 0;
    if (z.reloading > 0 && z._reloadTotal > 0) {
      const t = Math.min(1, 1 - z.reloading / z._reloadTotal);
      rl = Math.sin(Math.PI * t ** WEAPON_RELOAD.curve);
      // 탄창이 들어가는 소리는 **총이 다시 올라오기 시작할 무렵**에 나야 한다.
      // 시작할 때와 같은 음원을 더 빠르게 돌려 짧고 딱딱한 '철컥'으로 쓴다.
      if (!z._clackDone && t >= WEAPON_RELOAD.inAt) {
        z._clackDone = true;
        bus.emit(EV.SFX, {
          name: 'reload', volume: WEAPON_RELOAD.inVolume, rate: WEAPON_RELOAD.inRate,
        });
      }
    }

    const R = z.viewRoot;
    const k = Math.min(1, 14 * dt);
    const A = THROW_ANIM;
    R.position.x += (0.26 + aimX + bobX + sx + cpx - R.position.x) * k;
    R.position.y += (-0.24 + aimY + bobY + breath + sy + cpy
      + tWind * A.windUp - tThrow * A.throwDown        // 들었다가 훑어 내린다
      - rl * WEAPON_RELOAD.dropY - R.position.y) * k;
    R.position.z = -0.45 + aimZ + z._recoil * 0.10
      + wind * 0.06 - arc * 0.16 + cpz                   // 예비동작에 당겼다가 앞으로 내지른다
      + tWind * A.windBack - tThrow * A.throwFwd         // 뒤로 당겼다가 앞으로 뿌린다
      + z._impact * WEAPON_SWING.impactPush           // 부딪히면 손 쪽으로 되튄다
      + rl * WEAPON_RELOAD.pullZ;                        // 재장전은 몸 쪽으로 당긴다

    // 쉬는 자세 — 축에 딱 맞춰 놓으면 "박스를 들고 있다"로 보인다
    const rest = z.current.type === 'gun' && z.aiming
      ? { x: 0, y: 0, z: 0 }
      : { x: 0.05, y: -0.16, z: 0.10 };

    // 반발은 스윙 진행 방향의 **반대**로 튕긴다 — 그래야 막힌 것으로 보인다
    R.rotation.x = rest.x + z._recoil * 0.26 - wind * 0.42 + arc * 1.05 + sy * 1.4 + crx
      + tWind * A.windPitch + tThrow * A.throwPitch      // 젖혔다가 손목이 넘어간다
      - z._impact * WEAPON_SWING.impactPitch
      + rl * WEAPON_RELOAD.pitch;                        // 총구가 아래로 빠진다
    R.rotation.y = rest.y + (wind * 0.30 - arc * 0.62) * dir + sx * 1.6 + cry;
    R.rotation.z = rest.z + (wind * 0.34 - arc * 0.95) * dir + crz
      + tWind * A.windRoll + tThrow * A.throwRoll
      + z._impact * WEAPON_SWING.impactRoll * dir
      + rl * WEAPON_RELOAD.roll;                         // 탄창 쪽이 보이게 눕는다
}

  /** 뷰모델 재장전 동작을 처음부터 돌린다. 한 발씩 넣는 무기는 발마다 다시 부른다 */
export function _startReloadAnim(z, seconds) {
    z._reloadTotal = seconds;
    z._clackDone = false;
}

