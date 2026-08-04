import * as THREE from 'three';
import { WEAPONS, STARTING_LOADOUT } from '../config/weapons.js';
import { NOISE, SURFACE, WEAPON_VIEW } from '../config/balance.js';
import { bus, EV } from '../core/EventBus.js';
import { WEAPON_MODELS, cloneWeaponGLB } from './ViewModels.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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
  }

  get current() { return WEAPONS[this.inventory[this.index]]; }

  pickUp(id) {
    if (!WEAPONS[id]) return false;
    if (!this.inventory.includes(id)) this.inventory.push(id);
    this._initAmmo(id);
    bus.emit(EV.HINT, { text: `${WEAPONS[id].label} 획득`, duration: 2 });
    return true;
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
    this.reloading = 0;
    this.cooldown = 0.25;
    this._buildViewModel();
    bus.emit(EV.WEAPON_CHANGED, { weapon: this.current });
    this._emitAmmo();
  }

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
        o.material.color.multiplyScalar(SURFACE.viewModelDim * (WEAPON_VIEW.colorMul ?? 1));
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
    else this._throw(def);
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

  /** 레이 위에서 가장 가까운 좀비를 찾는다 (구 근사) */
  _hitscan(origin, dir, range, damage, stun) {
    const zombies = this.getZombies();
    let best = null, bestT = range;

    for (const z of zombies) {
      if (!z.active || z.state === 'DEAD') continue;
      const cx = z.pos.x - origin.x;
      const cy = (z.pos.y + z.def.height * 0.55) - origin.y;
      const cz = z.pos.z - origin.z;
      const t = cx * dir.x + cy * dir.y + cz * dir.z;   // 레이 위 투영 거리
      if (t < 0 || t > bestT) continue;
      const px = cx - dir.x * t, py = cy - dir.y * t, pz = cz - dir.z * t;
      const distSq = px * px + py * py + pz * pz;
      const r = z.def.radius + 0.12;
      if (distSq > r * r) continue;
      // 벽 뒤면 무효
      if (this.collision.segmentBlocked(origin.x, origin.z, z.pos.x, z.pos.z)) continue;
      best = z; bestT = t;
    }

    if (best) {
      const headshot = (origin.y + dir.y * bestT) > best.pos.y + best.def.height * 0.78;
      best.hit(damage * (headshot ? 2.2 : 1), stun, headshot);
    }
  }

  // ───────────────────────── 근접 ─────────────────────────
  _swingMelee(def) {
    this.cooldown = def.cooldown;
    // 시간 기반 스윙. 예비동작 → 타격 → 마무리 순서가 있어야 "휘둘렀다"로 읽힌다
    this._swingT = 0;
    this._swingDur = Math.min(def.cooldown * 0.92, 0.62);
    this._swingDir = -this._swingDir;        // 좌우 번갈아 휘두른다
    bus.emit(EV.SFX, { name: 'melee_swing', volume: 0.6 });

    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const halfArc = Math.cos(THREE.MathUtils.degToRad(def.arcDeg) / 2);
    const zombies = this.getZombies();
    let hitAny = false;

    for (const z of zombies) {
      if (!z.active || z.state === 'DEAD') continue;
      const dx = z.pos.x - this.player.pos.x;
      const dz = z.pos.z - this.player.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > def.range + z.def.radius) continue;
      const dot = (dx / dist) * fwd.x + (dz / dist) * fwd.z;
      if (dot < halfArc) continue;
      // 팔에 힘이 빠진다 — 다칠수록 근접이 약해진다 (Player.meleeMul)
      const mul = this.player.meleeMul ?? 1;
      z.hit(def.damage * mul, def.stun * mul, false);
      hitAny = true;
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
        if (d <= def.radius) z.hit(def.damage, 0.5, false);
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
        if (a.reserve > 0 && a.mag < def.magSize) this.reloading = def.reloadTime;
      }
    } else {
      const need = Math.min(def.magSize - a.mag, a.reserve);
      a.mag += need; a.reserve -= need;
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
      melee: def.type !== 'gun',
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
    this._idle += dt;
    const sp = this.player.speed;
    this._bob += dt * (sp > 0.5 ? 8.5 : 0);

    // ── 스윙: 예비동작(0~24%) → 타격(24~54%) → 마무리(54~100%) ──
    let wind = 0, arc = 0;
    if (this._swingT < this._swingDur) {
      this._swingT += dt;
      const p = Math.min(1, this._swingT / this._swingDur);
      const w = p < 0.24 ? p / 0.24 : 1;
      const strike = p < 0.24 ? 0 : Math.min(1, (p - 0.24) / 0.30);
      const rec = p < 0.54 ? 0 : (p - 0.54) / 0.46;
      arc = easeIn(strike) * (1 - easeInOut(Math.min(1, rec)));
      wind = easeOut(w) * (1 - strike);
    }
    this._swing = arc;
    const dir = this._swingDir;

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
    R.position.x += (0.26 + aimX + bobX + sx - R.position.x) * k;
    R.position.y += (-0.24 + aimY + bobY + breath + sy - R.position.y) * k;
    R.position.z = -0.45 + aimZ + this._recoil * 0.10
      + wind * 0.06 - arc * 0.16;                        // 예비동작에 당겼다가 앞으로 내지른다

    // 쉬는 자세 — 축에 딱 맞춰 놓으면 "박스를 들고 있다"로 보인다
    const rest = this.current.type === 'gun' && this.aiming
      ? { x: 0, y: 0, z: 0 }
      : { x: 0.05, y: -0.16, z: 0.10 };

    R.rotation.x = rest.x + this._recoil * 0.26 - wind * 0.42 + arc * 1.05 + sy * 1.4;
    R.rotation.y = rest.y + (wind * 0.30 - arc * 0.62) * dir + sx * 1.6;
    R.rotation.z = rest.z + (wind * 0.34 - arc * 0.95) * dir;
  }
}
