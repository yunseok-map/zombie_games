import * as THREE from 'three';
import { WEAPONS, STARTING_LOADOUT } from '../config/weapons.js';
import { MUZZLE, NOISE, SURFACE, WEAPON_VIEW, WEAPON_SWING } from '../config/balance.js';
import { getCurve, sampleCurve } from './SwingCurves.js';
import { bus, EV } from '../core/EventBus.js';
import { WEAPON_MODELS, cloneWeaponGLB } from './ViewModels.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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

/**
 * WeaponSystem — 무기 종류를 몰라야 한다. 전부 config/weapons.js 의 데이터로 동작한다.
 * 무기를 추가하려면 이 파일이 아니라 weapons.js 에 정의를 넣는다.
 */
export class WeaponSystem {
  constructor(camera, scene, player, collision, getZombies) {
    this.camera = camera;
    this.player = player;
    this.collision = collision;
    this.getZombies = getZombies;

    this.inventory = [...STARTING_LOADOUT];
    this.index = 0;
    this.ammo = {};      // { [id]: { mag, reserve } }
    this.cooldown = 0;
    this.reloading = 0;
    this.aiming = false;

    for (const id of this.inventory) this._initAmmo(id);

    // ── 뷰모델 (임시 박스. GLB 들어오면 교체) ──
    this.viewRoot = new THREE.Group();
    this.viewRoot.position.set(0.26, -0.24, -0.45);
    camera.add(this.viewRoot);

    // 총구 화염 — 칠흑 속에서 총을 쏘면 한순간 주변이 전부 드러나야 한다.
    // 그림자는 만들지 않는다 (CLAUDE.md §3 — 그림자 광원은 손전등뿐).
    this._muzzle = 0;
    this.muzzleLight = new THREE.PointLight(MUZZLE.color, 0, MUZZLE.range, 1.6);
    this.muzzleLight.castShadow = false;
    this.muzzleLight.position.set(0.1, -0.05, -0.55);
    camera.add(this.muzzleLight);
    this.viewMesh = null;
    this.viewParts = [];
    // 뷰모델 재질 — 손전등 코앞이라 전부 눌러 쓴다. 무기마다 만들지 않고 공유한다.
    const dim = SURFACE.viewModelDim;
    const M = (c, rough, metal) => new THREE.MeshStandardMaterial({
      color: new THREE.Color(c).multiplyScalar(dim), roughness: rough, metalness: metal,
    });
    this.viewMats = {
      steel: M(0x9aa2aa, 0.34, 0.85),
      dark:  M(0x6a6f74, 0.62, 0.55),
      grip:  M(0x7b6f60, 0.92, 0.05),
      accent: M(0xb2452e, 0.6, 0.15),
      glass: new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x9fb4a8).multiplyScalar(dim * 1.6),
        roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.55,
      }),
    };
    this._recoil = 0;
    this._swing = 0;
    this._swingT = 99; this._swingDur = 0.5; this._swingDir = 1;
    // 접촉 시점 판정 예약 · 부딪힌 뒤의 반발
    this._meleePending = null; this._meleeAt = 0; this._impact = 0;
    this._bob = 0;
    this._swayX = 0; this._swayY = 0;   // 마우스를 돌리면 무기가 뒤따라온다
    this._idle = 0;

    this._buildViewModel();
  }

  _initAmmo(id) {
    const def = WEAPONS[id];
    if (def?.type === 'gun' && !this.ammo[id]) {
      this.ammo[id] = { mag: def.magSize, reserve: def.magSize * 3 };
    }
    // 투척물은 개수로 센다. reserve 는 안 쓴다 (재장전이 없다)
    if (def?.type === 'throw' && !this.ammo[id]) {
      this.ammo[id] = { mag: def.charges ?? 3, reserve: 0 };
    }
  }

  get current() { return WEAPONS[this.inventory[this.index]]; }

  pickUp(id) {
    if (!WEAPONS[id]) return false;
    if (!this.inventory.includes(id)) this.inventory.push(id);
    this._initAmmo(id);
    bus.emit(EV.HINT, { text: `${WEAPONS[id].label} 획득`, duration: 2 });
    return true;
  }

  /** 체크포인트용 — 들고 있던 무기와 탄약을 통째로 적어 둔다 (core/Game.js) */
  snapshotState() {
    return {
      inventory: [...this.inventory],
      ammo: JSON.parse(JSON.stringify(this.ammo)),
    };
  }

  /**
   * 체크포인트에서 되돌린다.
   * @param minAmmo 예비탄이 이보다 적으면 여기까지 채운다 — 0 발로 되살아나면
   *   사건 구간이 통째로 막혀서 다시 죽는 것 말고 할 수 있는 게 없다.
   */
  restoreState(snap, minAmmo = 0) {
    if (!snap) return;
    this.inventory = [...snap.inventory];
    this.ammo = JSON.parse(JSON.stringify(snap.ammo));
    for (const id of this.inventory) {
      const def = WEAPONS[id];
      if (def?.type !== 'gun') continue;
      this._initAmmo(id);
      const a = this.ammo[id];
      if (a.mag + a.reserve < minAmmo) a.reserve = Math.max(0, minAmmo - a.mag);
    }
    this.cancelSwing();          // 죽기 직전에 예약된 타격이 되살아난 뒤에 들어가면 안 된다
    this._impact = 0;
    this.switchTo(1);            // 근접으로 되돌린다 — 되살아난 직후 총부터 쥐고 있으면 낭비한다
    this.refreshViewModel();
    this._emitAmmo();
  }

  addAmmo(id, amount) {
    this._initAmmo(id);
    if (this.ammo[id]) this.ammo[id].reserve += amount;
    this._emitAmmo();
  }

  switchTo(slot) {
    const idx = this.inventory.findIndex((id) => WEAPONS[id].slot === slot);
    if (idx < 0 || idx === this.index) return;
    this.index = idx;
    // 재장전 중에 무기를 바꾸면 진행 링이 화면에 남는다 — 여기서도 끝을 알려야 한다
    if (this.reloading > 0) bus.emit(EV.RELOAD_END, { cancelled: true });
    this.reloading = 0;
    this.cancelSwing();          // 예약된 근접 판정이 새 무기로 들어가면 안 된다
    this._impact = 0;
    this.cooldown = 0.25;
    this._buildViewModel();
    bus.emit(EV.WEAPON_CHANGED, { weapon: this.current });
    this._emitAmmo();
  }

  /**
   * 뷰모델을 다시 만든다. **GLB 프리로드가 끝난 뒤 한 번 불러야 한다.**
   * main.js 가 Game 을 먼저 만들고 모델을 나중에 받으므로, 시작 무기(쇠파이프·권총)는
   * 생성 시점에 GLB 가 없어서 절차적 모델로 만들어진다. 그대로 두면 시작 무기만
   * 계속 절차적으로 보인다 (다른 무기로 바꿨다 돌아오면 그때야 GLB 가 나온다).
   */
  refreshViewModel() { this._buildViewModel(); }

  _buildViewModel() {
    for (const m of this.viewParts) { this.viewRoot.remove(m); m.geometry?.dispose(); }
    this.viewParts.length = 0;
    // GLB 는 Group 이라 geometry 가 없다 — 옵셔널로 접근해야 한다
    if (this.viewMesh) { this.viewRoot.remove(this.viewMesh); this.viewMesh.geometry?.dispose(); this.viewMesh = null; }

    const def = this.current;

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
      this.viewRoot.add(glb);
      this.viewParts.push(glb);
      this.viewMesh = glb;
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
        const m = new THREE.Mesh(merged, this.viewMats[key] ?? this.viewMats.dark);
        m.frustumCulled = false;      // 카메라 자식이라 컬링 판정이 어긋난다
        this.viewRoot.add(m);
        this.viewParts.push(m);
      }
      this.viewMesh = this.viewParts[0] ?? null;   // 애니메이션 코드가 참조한다
      return;
    }

    // 모델이 없는 무기는 예전처럼 박스로 대체한다 (CLAUDE.md §1-2 — 없어도 돌아가야 한다)
    const s = def.viewScale ?? [0.08, 0.1, 0.4];
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(def.viewColor ?? 0x555555).multiplyScalar(SURFACE.viewModelDim),
      roughness: 0.55, metalness: 0.75,
    });
    this.viewMesh = new THREE.Mesh(new THREE.BoxGeometry(s[0], s[1], s[2]), mat);
    this.viewMesh.position.z = -s[2] / 2;
    this.viewRoot.add(this.viewMesh);
    this.viewParts.push(this.viewMesh);
  }

  update(dt, input) {
    if (this.cooldown > 0) this.cooldown -= dt;

    if (input.justPressed('Digit1')) this.switchTo(1);
    if (input.justPressed('Digit2')) this.switchTo(2);
    if (input.justPressed('Digit3')) this.switchTo(3);
    if (input.justPressed('KeyR')) this.reload();

    this.aiming = input.mouseRight && this.current.type === 'gun';

    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) this._finishReload();
    } else {
      const def = this.current;
      const wantFire = def.type === 'gun' && !def.semiOnly
        ? input.mouseLeft : input.mouseLeftPressed;
      if (wantFire && this.cooldown <= 0) this.attack();
    }

    this._animateViewModel(dt, input);
  }

  attack() {
    const def = this.current;
    if (def.type === 'gun') this._fireGun(def);
    else if (def.type === 'melee') this._swingMelee(def);
    else {
      // 투척은 개수가 있다. 무한이면 라디오 하나로 게임 전체를 우회할 수 있다 —
      // 아껴 쓸지 지금 쓸지가 곧 이 무기의 재미다.
      const a = this.ammo[def.id];
      if (a && a.mag <= 0) {
        bus.emit(EV.HINT, { text: `${def.label} 없음`, duration: 1.2 });
        return;
      }
      if (a) { a.mag--; this._emitAmmo(); }
      this._throw(def);
    }
  }

  // ───────────────────────── 총기 ─────────────────────────
  _fireGun(def) {
    const a = this.ammo[def.id];
    if (!a || a.mag <= 0) {
      bus.emit(EV.HINT, { text: '탄창 비어 있음 — R', duration: 1.2 });
      this.cooldown = 0.35;
      if (a && a.reserve > 0) this.reload();
      return;
    }
    a.mag--;
    this.cooldown = def.cooldown;
    this._recoil = 1;
    this._muzzle = MUZZLE.duration;    // 총구 화염 — 한순간 복도 전체가 드러난다

    const origin = new THREE.Vector3().copy(this.camera.position);
    const baseDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const spread = def.spread * (this.aiming ? 0.45 : 1);

    for (let p = 0; p < (def.pellets ?? 1); p++) {
      const dir = baseDir.clone();
      dir.x += (Math.random() - 0.5) * spread * 2;
      dir.y += (Math.random() - 0.5) * spread * 2;
      dir.z += (Math.random() - 0.5) * spread * 2;
      dir.normalize();
      this._hitscan(origin, dir, def.range, def.damage, 0.35);
    }

    bus.emit(EV.SFX, { name: 'pistol_fire', volume: def.silenced ? 0.35 : 1 });
    bus.emit(EV.NOISE, {
      x: this.player.pos.x, z: this.player.pos.z,
      radius: NOISE[def.noise] ?? NOISE.gunshot, source: 'gunshot',
    });
    bus.emit(EV.WEAPON_FIRED, { weapon: def });
    this._emitAmmo();
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
  _hitscan(origin, dir, range, damage, stun) {
    const zombies = this.getZombies();
    let best = null, bestT = range, bestS = 0;

    for (const z of zombies) {
      if (!z.active || z.state === 'DEAD') continue;
      const cap = capsuleOf(z);
      const r = cap.r + 0.12;
      const hit = rayVsSegment(origin, dir, cap);
      if (hit.t < 0 || hit.t > bestT) continue;
      if (hit.distSq > r * r) continue;
      // 벽 뒤면 무효
      if (this.collision.segmentBlocked(origin.x, origin.z, z.pos.x, z.pos.z)) continue;
      best = z; bestT = hit.t; bestS = hit.s;
    }

    if (best) {
      // 엎드린 몸은 머리가 **앞끝**에 있다. 서 있으면 위쪽이다.
      const headshot = best.def.crawler
        ? bestS > 0.74
        : (origin.y + dir.y * bestT) > best.pos.y + best.def.height * 0.78;
      best.hit(damage * (headshot ? 2.2 : 1), stun, headshot, origin);
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
  _swingMelee(def) {
    this.cooldown = def.cooldown;
    // 시간 기반 스윙. 예비동작 → 타격 → 마무리 순서가 있어야 "휘둘렀다"로 읽힌다
    this._swingT = 0;
    this._swingDur = Math.min(def.cooldown * 0.92, 0.62);
    this._swingDir = -this._swingDir;        // 좌우 번갈아 휘두른다
    this._impact = 0;                        // 지난 스윙의 반발이 남아 있으면 궤적이 끊긴다
    // 궤적도 번갈아 쓴다 — 같은 곡선만 반복하면 사람이 휘두르는 느낌이 도로 사라진다
    this._swingCurve = getCurve(this._swingDir > 0
      ? 'standing_melee_attack_downward'
      : 'standing_melee_attack_backhand');
    bus.emit(EV.SFX, { name: 'melee_swing', volume: 0.6 });

    // 판정을 접촉 시점으로 예약한다. 상한을 두는 이유는 쿨다운이 긴 무기에서
    // 클릭이 씹힌 느낌이 나지 않게 하기 위해서다.
    this._meleePending = def;
    this._meleeAt = Math.min(
      this._swingDur * WEAPON_SWING.contact, WEAPON_SWING.contactMaxDelay);
  }

  /** 예약된 근접 판정이 있으면 취소한다 — 무기 교체·부활 시 유령 타격을 막는다 */
  cancelSwing() { this._meleePending = null; }

  /**
   * 실제 판정. **접촉 시점의 시선·위치**를 쓴다 — 휘두르는 도중 몸을 돌리면
   * 빗나간다. 좀비 공격과 같은 규칙이 되는 것이라 이쪽이 맞다.
   */
  _resolveMelee(def) {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
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
    const zombies = this.getZombies();
    let hitAny = false;

    for (const z of zombies) {
      if (!z.active || z.state === 'DEAD') continue;
      const dx = z.pos.x - this.player.pos.x;
      const dz = z.pos.z - this.player.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > def.range + z.def.radius) continue;
      // 발밑에 딱 붙은 개체는 방향이 무의미하다 — 나누면 0으로 나뉘어 판정이 튄다
      const close = dist < 1e-3;
      const dot = close ? 1 : (dx / dist) * fx + (dz / dist) * fz;
      if (dot < halfArc) continue;
      // **벽 너머는 못 때린다.** 총은 이미 이 규칙을 지키는데(_hitscan) 근접만
      // 빠져 있어서, 문 하나 사이에 두고 붙은 좀비를 쇠파이프로 때릴 수 있었다.
      if (this.collision.segmentBlocked(
        this.player.pos.x, this.player.pos.z, z.pos.x, z.pos.z)) continue;

      // 근접에도 머리 판정이 있다. 예전에는 세 번째 인자가 **항상 false 하드코딩**이라
      // 도끼로 머리를 찍어도 정강이를 친 것과 데미지·소리·피가 전부 같았다.
      // 발밑에 붙은 개체는 레이가 튀므로 판정하지 않는다.
      let headshot = false;
      if (!close) {
        const cap = capsuleOf(z);
        const h = rayVsSegment(this.camera.position, fwd, cap);
        headshot = h.distSq <= (cap.r + 0.12) ** 2 && h.s > WEAPON_SWING.meleeHeadS;
      }
      // 팔에 힘이 빠진다 — 다칠수록 근접이 약해진다 (Player.meleeMul)
      const mul = this.player.meleeMul ?? 1;
      z.hit(def.damage * mul * (headshot ? 2.2 : 1), def.stun * mul, headshot, this.player.pos);
      hitAny = true;
    }

    // 닿았을 때만 화면이 걸린다. 헛스윙에도 흔들리면 타격의 의미가 사라진다
    if (hitAny) {
      this._impact = 1;                      // 무기가 그 자리에서 걸렸다가 튕겨 돌아온다
      bus.emit(EV.MELEE_HIT, { x: this.player.pos.x, z: this.player.pos.z });
    } else {
      // 아무도 못 맞혔으면 **벽을 쳤는지** 본다. 지금까지는 벽이라는 개념이
      // 근접에 아예 없어서 무기가 벽을 관통해 그냥 지나갔다.
      // Collision 은 2D AABB 라 높이를 모른다 — 벽으로 등록된 박스만 잡힌다.
      //
      // **끝점 하나만 보면 안 된다.** 벽 두께가 0.2m 라 0.85 x 사거리(1.45m) 지점은
      // 벽을 통째로 지나쳐 버린다 — 실측에서 벽 앞 0.75m 에 서서 휘둘렀는데
      // 한 번도 안 잡혔다. 무기가 지나가는 경로를 **훑어야** 한다.
      const px = this.player.pos.x + fx * def.range * WEAPON_SWING.wallProbe;
      const pz = this.player.pos.z + fz * def.range * WEAPON_SWING.wallProbe;
      if (this.collision.segmentBlocked(
        this.player.pos.x, this.player.pos.z, px, pz, WEAPON_SWING.wallProbeStep)) {
        this._impact = 1;
        bus.emit(EV.MELEE_CLANG, { x: px, z: pz });
      }
    }

    // 타격음은 Zombie.hit() 이 부위·무기별로 낸다 (여기서 또 내면 겹친다)
    bus.emit(EV.NOISE, {
      x: this.player.pos.x, z: this.player.pos.z,
      radius: NOISE.melee, source: 'melee',
    });
  }

  // ───────────────────────── 투척 ─────────────────────────
  _throw(def) {
    this.cooldown = def.cooldown;
    this._swing = 1;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const tx = this.player.pos.x + fwd.x * 9;
    const tz = this.player.pos.z + fwd.z * 9;

    if (def.lure) {
      // 라디오 — 좀비를 그쪽으로 유인한다 (전투 회피 도구)
      bus.emit(EV.NOISE, { x: tx, z: tz, radius: def.lureRadius, source: 'lure' });
      bus.emit(EV.HINT, { text: '라디오를 던졌다', duration: 1.6 });
    } else {
      for (const z of this.getZombies()) {
        if (!z.active || z.state === 'DEAD') continue;
        const d = Math.hypot(z.pos.x - tx, z.pos.z - tz);
        if (d <= def.radius) z.hit(def.damage, 0.5, false, { x: tx, z: tz });
      }
      bus.emit(EV.NOISE, { x: tx, z: tz, radius: NOISE.melee, source: 'throw' });
    }
  }

  // ───────────────────────── 재장전 ─────────────────────────
  reload() {
    const def = this.current;
    if (def.type !== 'gun' || this.reloading > 0) return;
    const a = this.ammo[def.id];
    if (!a || a.mag >= def.magSize || a.reserve <= 0) return;
    this.reloading = def.reloadTime;
    // 재장전 중의 취약함이 이 게임의 공포 장치인데(CLAUDE.md §5-4) 그 시간을
    // 화면이 한 번도 표현하지 않았다 — 끝난 뒤 숫자가 바뀌는 것이 전부였다.
    bus.emit(EV.RELOAD_START, { seconds: def.reloadTime });
    bus.emit(EV.SFX, { name: 'reload', volume: 0.7 });
  }

  _finishReload() {
    const def = this.current;
    const a = this.ammo[def.id];
    if (!a) return;
    if (def.reloadPerShell) {
      // 산탄총 — 한 발씩. 남았으면 계속 장전
      if (a.reserve > 0 && a.mag < def.magSize) {
        a.mag++; a.reserve--;
        if (a.reserve > 0 && a.mag < def.magSize) {
          this.reloading = def.reloadTime;
          // 한 발씩 넣는 무기는 여기서 다시 시작한다 — 안 알리면 링이 첫 발에서 멈춘다
          bus.emit(EV.RELOAD_START, { seconds: def.reloadTime });
        } else bus.emit(EV.RELOAD_END, {});
      } else bus.emit(EV.RELOAD_END, {});
    } else {
      const need = Math.min(def.magSize - a.mag, a.reserve);
      a.mag += need; a.reserve -= need;
      bus.emit(EV.RELOAD_END, {});
    }
    this._emitAmmo();
  }

  _emitAmmo() {
    const def = this.current;
    const a = this.ammo[def.id];
    bus.emit(EV.AMMO_CHANGED, {
      label: def.label,
      mag: a ? a.mag : null,
      reserve: a ? a.reserve : null,
      // 근접만 ∞ 다. 투척물은 개수가 있으므로 숫자를 보여줘야 아껴 쓸지 판단할 수 있다
      melee: def.type === 'melee',
      throwable: def.type === 'throw',
    });
  }

  /**
   * 뷰모델 애니메이션.
   * 손맛의 대부분은 모델이 아니라 여기서 나온다 —
   * 예비동작 · 궤적 · 마무리, 그리고 시선을 돌릴 때 무기가 뒤따라오는 관성.
   */
  _animateViewModel(dt, input) {
    const easeOut = (t) => 1 - (1 - t) ** 3;
    const easeIn = (t) => t * t * t;
    const easeInOut = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

    this._recoil = Math.max(0, this._recoil - dt * 7);

    // 총구 화염은 아주 짧게, 그리고 세기를 조금씩 흔든다 (매번 같으면 스트로브처럼 보인다)
    if (this._muzzle > 0) {
      this._muzzle = Math.max(0, this._muzzle - dt);
      const k = this._muzzle / MUZZLE.duration;
      this.muzzleLight.intensity = MUZZLE.intensity * k * k * (0.82 + Math.random() * 0.36);
    } else if (this.muzzleLight.intensity !== 0) {
      this.muzzleLight.intensity = 0;
    }

    this._idle += dt;
    const sp = this.player.speed;
    this._bob += dt * (sp > 0.5 ? 8.5 : 0);

    // 접촉 반발 — 닿은 자리에서 멎었다가 손 쪽으로 튕겨 돌아온다.
    // 이게 없으면 살을 치든 허공을 치든 궤적이 100% 같아서, 화면이 흔들려도
    // "부딪혔다"가 아니라 "휘두르는 중에 화면이 흔들렸다"로 읽힌다.
    if (this._impact > 0) {
      this._impact = Math.max(0, this._impact - dt * WEAPON_SWING.impactDecay);
    }

    // ── 스윙: 예비동작(0~24%) → 타격(24~54%) → 마무리(54~100%) ──
    let wind = 0, arc = 0;
    if (this._swingT < this._swingDur) {
      // 닿는 순간 진행이 느려진다 — 무기가 그 자리에서 걸린다
      this._swingT += dt * (1 - WEAPON_SWING.impactSlow * this._impact);
      // 무기가 가장 뻗는 순간에 판정이 들어간다 (예약은 _swingMelee 가 건다)
      if (this._meleePending && this._swingT >= this._meleeAt) {
        const d = this._meleePending;
        this._meleePending = null;
        this._resolveMelee(d);
      }
      const p = Math.min(1, this._swingT / this._swingDur);
      const w = p < 0.24 ? p / 0.24 : 1;
      const strike = p < 0.24 ? 0 : Math.min(1, (p - 0.24) / 0.30);
      const rec = p < 0.54 ? 0 : (p - 0.54) / 0.46;
      arc = easeIn(strike) * (1 - easeInOut(Math.min(1, rec)));
      wind = easeOut(w) * (1 - strike);
    }
    this._swing = arc;
    const dir = this._swingDir;

    // ── 사람이 휘두른 궤적 ──
    // 절차적 사인 곡선은 가감속이 일정해서 "기계가 돈다"로 보인다.
    // 실제 모션에서 뽑은 곡선을 섞으면 예비동작에서 뜸을 들이고 타격에서 확 빠진다.
    // 곡선 파일이 없으면 전부 0 이라 기존 절차적 스윙만 남는다 (폴백).
    let cpx = 0, cpy = 0, cpz = 0, crx = 0, cry = 0, crz = 0;
    if (WEAPON_SWING.enabled) {
      const melee = this._swingT < this._swingDur && this._swingCurve;
      const gun = this._recoil > 0.001 ? getCurve('shooting') : null;
      if (melee) {
        const s = sampleCurve(this._swingCurve, this._swingT / this._swingDur);
        const ps = WEAPON_SWING.posScale * WEAPON_SWING.blend;
        const rs = WEAPON_SWING.rotScale * WEAPON_SWING.blend;
        cpx = s.p[0] * ps * dir; cpy = s.p[1] * ps; cpz = s.p[2] * ps;
        crx = s.e[0] * rs;       cry = s.e[1] * rs * dir; crz = s.e[2] * rs * dir;
      } else if (gun) {
        // 반동은 곡선의 앞부분만 쓴다 — 총은 휘두르는 게 아니라 튀었다가 돌아온다
        const s = sampleCurve(gun, (1 - this._recoil) * 0.5);
        cpx = s.p[0] * WEAPON_SWING.gunPosScale; cpy = s.p[1] * WEAPON_SWING.gunPosScale;
        cpz = s.p[2] * WEAPON_SWING.gunPosScale;
        crx = s.e[0] * WEAPON_SWING.gunRotScale; cry = s.e[1] * WEAPON_SWING.gunRotScale;
        crz = s.e[2] * WEAPON_SWING.gunRotScale;
      }
    }

    // ── 마우스 관성: 시선을 돌리면 무기가 반대로 밀렸다가 따라온다 ──
    const swayMul = this.player.swayMul ?? 1;
    if (input) {
      this._swayX += (-input.mouseDX * 0.0016 * swayMul - this._swayX) * Math.min(1, 14 * dt);
      this._swayY += (-input.mouseDY * 0.0014 * swayMul - this._swayY) * Math.min(1, 14 * dt);
    }
    this._swayX *= 1 - Math.min(1, 6 * dt);
    this._swayY *= 1 - Math.min(1, 6 * dt);
    const sx = THREE.MathUtils.clamp(this._swayX, -0.09, 0.09);
    const sy = THREE.MathUtils.clamp(this._swayY, -0.07, 0.07);

    // ── 걷기 흔들림 + 숨쉬기 ──
    const spN = Math.min(1, sp / 3);
    const bobX = Math.sin(this._bob) * 0.014 * spN;
    const bobY = Math.abs(Math.cos(this._bob)) * 0.012 * spN;
    const breath = Math.sin(this._idle * 1.5) * 0.004 * (1 - spN) * swayMul;

    // ── 정조준 ──
    const aimX = this.aiming ? -0.26 : 0;
    const aimY = this.aiming ? 0.09 : 0;
    const aimZ = this.aiming ? 0.08 : 0;

    const R = this.viewRoot;
    const k = Math.min(1, 14 * dt);
    R.position.x += (0.26 + aimX + bobX + sx + cpx - R.position.x) * k;
    R.position.y += (-0.24 + aimY + bobY + breath + sy + cpy - R.position.y) * k;
    R.position.z = -0.45 + aimZ + this._recoil * 0.10
      + wind * 0.06 - arc * 0.16 + cpz                   // 예비동작에 당겼다가 앞으로 내지른다
      + this._impact * WEAPON_SWING.impactPush;          // 부딪히면 손 쪽으로 되튄다

    // 쉬는 자세 — 축에 딱 맞춰 놓으면 "박스를 들고 있다"로 보인다
    const rest = this.current.type === 'gun' && this.aiming
      ? { x: 0, y: 0, z: 0 }
      : { x: 0.05, y: -0.16, z: 0.10 };

    // 반발은 스윙 진행 방향의 **반대**로 튕긴다 — 그래야 막힌 것으로 보인다
    R.rotation.x = rest.x + this._recoil * 0.26 - wind * 0.42 + arc * 1.05 + sy * 1.4 + crx
      - this._impact * WEAPON_SWING.impactPitch;
    R.rotation.y = rest.y + (wind * 0.30 - arc * 0.62) * dir + sx * 1.6 + cry;
    R.rotation.z = rest.z + (wind * 0.34 - arc * 0.95) * dir + crz
      + this._impact * WEAPON_SWING.impactRoll * dir;
  }
}
