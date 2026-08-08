import * as THREE from 'three';
import { WEAPONS, STARTING_LOADOUT } from '../config/weapons.js';
import { MUZZLE, SURFACE, WEAPON_RELOAD, THROW_ANIM } from '../config/balance.js';
import { bus, EV } from '../core/EventBus.js';
import * as WeaponViewModel from './WeaponViewModel.js';
import * as WeaponAttack from './WeaponAttack.js';

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
      // 화염병 심지. **여기만 dim 을 안 곱한다** — 스스로 타는 것이라 눌러 놓으면
      // 손에 든 게 그냥 병으로 보인다. 손전등을 꺼도 이것만 보여야 맞다.
      flame: new THREE.MeshStandardMaterial({
        color: 0xffb055, emissive: 0xff6a1a, emissiveIntensity: 2.6,
        roughness: 1, metalness: 0,
      }),
    };
    this._recoil = 0;
    this._swing = 0;
    this._swingT = 99; this._swingDur = 0.5; this._swingDir = 1;
    // 던지는 동작. 99 는 "돌고 있지 않다" 는 뜻 (_swingT 와 같은 규약)
    this._throwT = 99; this._throwDur = THROW_ANIM.dur;
    this._throwPending = null;
    this._emptyAfterThrow = false;   // 마지막 하나를 던졌다 — 동작이 끝나면 손을 비운다
    // 접촉 시점 판정 예약 · 부딪힌 뒤의 반발
    this._meleePending = null; this._meleeAt = 0; this._impact = 0;
    this._bob = 0;
    // 재장전 동작 — 진행률을 남은 시간에서 뽑으므로 전체 길이를 들고 있어야 한다
    this._reloadTotal = 0; this._clackDone = false;
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
    const isNew = !this.inventory.includes(id);
    if (isNew) this.inventory.push(id);
    this._initAmmo(id);
    // **주우면 바로 손에 쥔다.** E 를 눌러 집어 든 것이므로 의도가 분명하고,
    // 안 그러면 "획득" 문구만 뜨고 화면이 그대로라 주운 줄도 모른다.
    if (isNew) {
      this.index = this.inventory.length - 1;
      this.cancelSwing();
      this._impact = 0;
      this.cooldown = 0.25;
      this._buildViewModel();
      bus.emit(EV.WEAPON_CHANGED, { weapon: this.current });
      this._emitAmmo();
    }
    const slot = WEAPONS[id].slot;
    bus.emit(EV.HINT, {
      text: `${WEAPONS[id].label} 획득 — ${slot} 키로 전환`, duration: 2.6,
    });
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

  /**
   * 슬롯 키를 누르면 **그 슬롯의 무기를 차례로 돌린다.**
   *
   * 예전에는 `findIndex` 로 그 슬롯의 **첫 무기**만 골랐다. 근접이 전부 슬롯 1 이므로
   * 쇠지렛대(B1)·소방도끼(3F)·소화기를 주워도 1번 키는 영원히 쇠파이프를 잡았다 —
   * **구역마다 무기를 하나씩 놓아 뒀는데 주운 순간 죽은 무기가 됐다.**
   * 인벤토리에 그 슬롯이 하나뿐이면 동작은 예전과 같다.
   */
  switchTo(slot) {
    const idxs = [];
    for (let i = 0; i < this.inventory.length; i++) {
      if (WEAPONS[this.inventory[i]].slot === slot) idxs.push(i);
    }
    if (!idxs.length) return;
    const at = idxs.indexOf(this.index);
    // 이미 그 슬롯을 들고 있으면 다음 것으로, 아니면 그 슬롯의 첫 번째로
    const idx = at < 0 ? idxs[0] : idxs[(at + 1) % idxs.length];
    if (idx === this.index) return;
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

  _buildViewModel() { return WeaponViewModel._buildViewModel(this); }

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

  /**
   * ── 아래는 전부 `WeaponAttack` 으로 넘기는 한 줄 위임이다 ──
   *
   * 실제 구현과 **그 이유를 적은 주석은 WeaponAttack.js 한 곳에만** 둔다.
   * 여기에 같은 설명을 복사해 두면 한쪽만 고쳐져서 둘이 어긋난다 — 실제로
   * `_hitscan` · `_traceWorld` · `_swingMelee` 세 개가 그렇게 두 벌이었다.
   * 이 파일에 남는 것은 "무엇을 어디로 넘기는가"뿐이다.
   */
  // ───────────────────────── 총기 ─────────────────────────
  _fireGun(def) { return WeaponAttack._fireGun(this, def); }
  _hitscan(origin, dir, range, damage, stun) { return WeaponAttack._hitscan(this, origin, dir, range, damage, stun); }
  _traceWorld(origin, dir) { return WeaponAttack._traceWorld(this, origin, dir); }

  // ───────────────────────── 근접 ─────────────────────────
  _swingMelee(def) { return WeaponAttack._swingMelee(this, def); }
  _resolveMelee(def) { return WeaponAttack._resolveMelee(this, def); }

  // ───────────────────────── 투척 ─────────────────────────
  _throw(def) { return WeaponAttack._throw(this, def); }
  _releaseThrow() { return WeaponAttack._releaseThrow(this); }

  /**
   * 진행 중인 동작을 없던 일로 한다. 무기를 바꾸거나 되살아날 때 부른다.
   *
   * **던지기도 같이 끊어야 한다.** 안 그러면 두 가지가 남는다 —
   *  · 예약된 병이 그대로 날아간다 (이미 손에 없는 무기의 것이)
   *  · 던지는 도중 만들어진 새 뷰모델이 "빈손" 구간에 걸려 숨은 채로 남는다
   */
  cancelSwing() {
    this._meleePending = null;
    this._throwPending = null;
    this._emptyAfterThrow = false;
    this._throwT = 99;
    if (this.viewMesh) this.viewMesh.visible = true;
  }

  /**
   * 투척물을 다 썼을 때 손을 비운다.
   *
   * 그전에는 **없는 화염병을 계속 들고 있었다** — 개수가 0 인데 손에는 병이 있고,
   * 클릭하면 "화염병 없음" 만 뜬다. 근접(1번)으로 돌려준다. 근접은 탄약이 없으므로
   * 어떤 상황에서도 유효한 유일한 슬롯이다.
   */
  _autoSwitchFromEmpty() {
    const cur = this.current;
    if (!cur || cur.type !== 'throw') return;
    if ((this.ammo[cur.id]?.mag ?? 0) > 0) return;
    this.switchTo(1);
    bus.emit(EV.HINT, { text: `${cur.label} 소진`, duration: 1.4 });
  }

  // ───────────────────────── 재장전 ─────────────────────────
  reload() {
    const def = this.current;
    if (def.type !== 'gun' || this.reloading > 0) return;
    const a = this.ammo[def.id];
    if (!a || a.mag >= def.magSize || a.reserve <= 0) return;
    this.reloading = def.reloadTime;
    this._startReloadAnim(def.reloadTime);
    // 재장전 중의 취약함이 이 게임의 공포 장치인데(CLAUDE.md §5-4) 그 시간을
    // 화면이 한 번도 표현하지 않았다 — 끝난 뒤 숫자가 바뀌는 것이 전부였다.
    bus.emit(EV.RELOAD_START, { seconds: def.reloadTime });
    bus.emit(EV.SFX, {
      name: 'reload', volume: WEAPON_RELOAD.outVolume, rate: WEAPON_RELOAD.outRate,
    });
  }

  /** 뷰모델 재장전 동작을 처음부터 돌린다. 한 발씩 넣는 무기는 발마다 다시 부른다 */
  _startReloadAnim(seconds) { return WeaponViewModel._startReloadAnim(this, seconds); }

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
          this._startReloadAnim(def.reloadTime);   // 동작도 발마다 다시 돈다
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
  _animateViewModel(dt, input) { return WeaponViewModel._animateViewModel(this, dt, input); }
}
