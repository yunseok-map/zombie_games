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

    // ── 긴장 연출 레이어 ──────────────────────────────────
    // 체력이 깎이면 화면 가장자리가 붉게 맥동하고, 배터리가 바닥나면 경고가 뜬다.
    // 숫자를 읽게 하지 말고 몸으로 느끼게 만드는 게 목적이다.
    const css = document.createElement('style');
    css.textContent = `
      #vig{position:fixed;inset:0;pointer-events:none;z-index:5;opacity:0;
        background:radial-gradient(ellipse at center,transparent 42%,rgba(96,8,6,.85) 100%);
        transition:opacity .35s}
      #vig.on{animation:pulse 1.15s ease-in-out infinite}
      @keyframes pulse{0%,100%{opacity:.34}50%{opacity:.72}}
      #warn{position:fixed;left:50%;top:16%;transform:translateX(-50%);z-index:6;
        font:600 12px/1 ui-monospace,monospace;letter-spacing:.32em;color:#c8503c;
        opacity:0;transition:opacity .2s;pointer-events:none;text-shadow:0 0 12px rgba(200,60,40,.7)}
      #warn.on{animation:blink .9s steps(1) infinite}
      @keyframes blink{0%,55%{opacity:.95}56%,100%{opacity:.15}}
      #bars .bar{transition:box-shadow .3s}
      #bars .bar.crit{box-shadow:0 0 10px rgba(210,50,36,.85)}
      #crosshair{transition:transform .12s ease-out,opacity .2s}
    `;
    document.head.appendChild(css);
    this.vig = document.createElement('div'); this.vig.id = 'vig';
    this.warn = document.createElement('div'); this.warn.id = 'warn';
    document.body.append(this.vig, this.warn);
    this.crosshair = document.getElementById('crosshair');
    this.hpBar = document.getElementById('hp');
    this.battBar = document.getElementById('batt');

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

    // 체력이 낮을수록 화면 가장자리가 붉게 맥동한다
    const hpRatio = player.hp / PLAYER.maxHp;
    const hurt = hpRatio < 0.4;
    this.vig.style.opacity = hurt ? '' : '0';
    this.vig.classList.toggle('on', hurt);
    this.hpBar?.classList.toggle('crit', hpRatio < 0.25);

    // 배터리 경고 — 손전등이 이 게임의 생명줄이다
    const battRatio = flashlight.battery / FLASHLIGHT.maxBattery;
    const battLow = battRatio < 0.2;
    this.battBar?.classList.toggle('crit', battLow);
    const msg = flashlight.battery <= 0 ? '배터리 없음'
      : battLow ? '배터리 부족'
        : hpRatio < 0.25 ? '치명상' : '';
    if (msg !== this._warnMsg) {
      this._warnMsg = msg;
      this.warn.textContent = msg;
      this.warn.classList.toggle('on', !!msg);
      this.warn.style.opacity = msg ? '' : '0';
    }

    // 크로스헤어 — 움직일수록 벌어지고 흐려진다 (정지 사격을 유도)
    if (this.crosshair) {
      const spread = Math.min(1, player.speed / PLAYER.speedSprint);
      this.crosshair.style.transform = `scale(${1 + spread * 0.9})`;
      this.crosshair.style.opacity = String(0.85 - spread * 0.45);
    }

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
