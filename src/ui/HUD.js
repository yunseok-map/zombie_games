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
    this.hint.textContent = text;
    this.hint.classList.add('on');
    this._hintTimer = duration;
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
