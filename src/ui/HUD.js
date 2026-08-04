import { PLAYER, FLASHLIGHT } from '../config/balance.js';
import { bus, EV } from '../core/EventBus.js';

/**
 * HUD — DOM 오버레이. 캔버스에 그리지 않는다.
 * 이유: CSS 로 만드는 게 압도적으로 빠르고, 폰트가 선명하다.
 */
export class HUD {
  constructor() {
    this.root = document.getElementById('hud');
    this.hp = document.querySelector('#hp > i');
    this.stam = document.querySelector('#stam > i');
    this.batt = document.querySelector('#batt > i');
    this.ammoLabel = document.querySelector('#ammo .w');
    this.ammoNum = document.querySelector('#ammo .n');
    this.hint = document.getElementById('hint');
    this.dmg = document.getElementById('dmg');

    this._hintTimer = 0;
    this._dmgTimer = 0;
    this._prompt = null;

    // 진단 패널 — ` (백쿼트) 로 토글. 입력이 실제로 들어오는지 눈으로 본다
    this.dbg = document.createElement('div');
    this.dbg.style.cssText = 'position:fixed;left:10px;top:10px;z-index:99;display:none;'
      + 'font:12px/1.6 ui-monospace,Consolas,monospace;color:#7fd97f;white-space:pre;'
      + 'background:rgba(0,0,0,.72);padding:8px 10px;border:1px solid #2c4a2c;pointer-events:none';
    document.body.appendChild(this.dbg);
    this._fps = 0;

    bus.on(EV.HINT, ({ text, duration = 2 }) => this.showHint(text, duration));
    bus.on(EV.PLAYER_DAMAGED, () => this.flashDamage());
    bus.on(EV.AMMO_CHANGED, (a) => this.setAmmo(a));
    bus.on(EV.WEAPON_CHANGED, ({ weapon }) => { this.ammoLabel.textContent = weapon.label; });
  }

  show() { this.root.classList.add('on'); }
  hide() { this.root.classList.remove('on'); }

  setAmmo({ label, mag, reserve, melee }) {
    this.ammoLabel.textContent = label;
    this.ammoNum.innerHTML = melee ? '∞' : `${mag}<small> / ${reserve}</small>`;
  }

  showHint(text, duration = 2) {
    if (this._prompt) return;          // 상호작용 안내가 떠 있으면 그게 우선이다
    this.hint.textContent = text;
    this.hint.classList.add('on');
    this._hintTimer = duration;
  }

  /**
   * 상호작용 안내 — 대상 앞에 서 있는 동안 계속 떠 있는다.
   * 매 프레임 불려도 값이 안 바뀌면 DOM 을 건드리지 않는다.
   */
  setPrompt(text) {
    if (text === this._prompt) return;
    this._prompt = text;
    if (text) {
      this.hint.textContent = text;
      this.hint.classList.add('on');
      this._hintTimer = 0;
    } else {
      this.hint.classList.remove('on');
    }
  }

  toggleDebug() {
    this.dbg.style.display = this.dbg.style.display === 'none' ? 'block' : 'none';
  }

  /** @param {{input:object, player:object, dt:number, renderer:object, zombies:number}} s */
  updateDebug(s) {
    if (this.dbg.style.display === 'none') return;
    this._fps += (1 / Math.max(s.dt, 1e-4) - this._fps) * 0.1;
    const held = [...s.input.keys].join(' ') || '(없음)';
    const move = ['KeyW', 'KeyA', 'KeyS', 'KeyD']
      .map((k) => (s.input.keys.has(k) ? k[3] : '·')).join('');
    this.dbg.textContent =
      `FPS ${this._fps.toFixed(0)}   드로우콜 ${s.renderer.info.render.calls}\n`
      + `포인터락 ${s.input.locked ? 'O' : 'X'}   입력활성 ${s.input.enabled ? 'O' : 'X'}\n`
      + `WASD  [${move}]\n`
      + `눌린키 ${held}\n`
      + `속도 ${s.player.speed.toFixed(2)} m/s   좀비 ${s.zombies}`;
  }

  flashDamage() {
    this.dmg.style.opacity = '1';
    this._dmgTimer = 0.4;
  }

  update(dt, { player, flashlight }) {
    this.hp.style.transform = `scaleX(${player.hp / PLAYER.maxHp})`;
    this.stam.style.transform = `scaleX(${player.stamina / PLAYER.maxStamina})`;
    this.batt.style.transform = `scaleX(${flashlight.battery / FLASHLIGHT.maxBattery})`;

    if (this._hintTimer > 0) {
      this._hintTimer -= dt;
      if (this._hintTimer <= 0) this.hint.classList.remove('on');
    }
    if (this._dmgTimer > 0) {
      this._dmgTimer -= dt;
      if (this._dmgTimer <= 0) this.dmg.style.opacity = '0';
    }
  }
}
