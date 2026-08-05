import { PLAYER, FLASHLIGHT, NOISE, STEALTH } from '../config/balance.js';
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
    this.objective = document.getElementById('objective');
    this.objectiveText = document.querySelector('#objective span');
    this.exp = document.querySelector('#exp > i');
    this.expBar = document.getElementById('exp');
    this.expState = document.getElementById('exp-state');

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
    // 숫자 표시 — 값이 바뀔 때만 DOM 을 건드린다
    this._nums = {
      hp: document.getElementById('hp-n'),
      stam: document.getElementById('stam-n'),
      batt: document.getElementById('batt-n'),
      exp: document.getElementById('exp-n'),
    };
    this._numCache = {};
    this.crosshair = document.getElementById('crosshair');
    this.hpBar = document.getElementById('hp');
    this.battBar = document.getElementById('batt');

    bus.on(EV.HINT, ({ text, duration = 2 }) => this.showHint(text, duration));
    bus.on(EV.PLAYER_DAMAGED, ({ dir }) => this.flashDamage(dir));
    bus.on(EV.OBJECTIVE, ({ text }) => this.setObjective(text));
    bus.on(EV.AMMO_CHANGED, (a) => this.setAmmo(a));
    bus.on(EV.WEAPON_CHANGED, ({ weapon }) => { this.ammoLabel.textContent = weapon.label; });
  }

  show() { this.root.classList.add('on'); }
  hide() { this.root.classList.remove('on'); }

  setAmmo({ label, mag, reserve, melee, throwable }) {
    this.ammoLabel.textContent = label;
    // 근접만 ∞. 투척물은 예비탄이 없으니 개수 하나만 — "12 / 0" 은 재장전이 있는 것처럼 읽힌다
    this.ammoNum.innerHTML = melee ? '∞'
      : throwable ? `${mag}` : `${mag}<small> / ${reserve}</small>`;
    // 바닥나 가면 숫자가 붉어진다 — 재장전(또는 아껴 쓸) 타이밍을 눈으로 알 수 있어야 한다
    document.getElementById('ammo')?.classList.toggle('low', !melee && mag <= (throwable ? 1 : 3));
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

  /**
   * 지금 해야 할 일. HINT 와 달리 안 사라진다.
   * 어두운 5구역에서 "뭘 하라는 거지"가 되는 순간 플레이어는 그냥 끈다.
   */
  setObjective(text) {
    if (!this.objective) return;
    if (!text) { this.objective.classList.remove('on'); return; }
    if (this.objectiveText.textContent === text) return;   // 같은 문구면 다시 깜빡이지 않는다
    this.objectiveText.textContent = text;
    this.objective.classList.add('on');
    // 애니메이션을 다시 태우려면 클래스를 한 번 떼었다 붙여야 한다
    this.objective.classList.remove('changed');
    void this.objective.offsetWidth;
    this.objective.classList.add('changed');
  }

  /**
   * @param dir 화면 기준 피격 방향(rad). 0 = 정면, +가 오른쪽. null 이면 방향 없이 전방위.
   *   어둠 속에서 뒤에서 맞으면 방향을 모른 채 죽는다 — 그건 공포가 아니라 억울함이다.
   */
  flashDamage(dir = null) {
    this.dmg.style.opacity = '1';
    this._dmgTimer = 0.4;
    if (dir == null) { this.dmg.style.removeProperty('--dir'); this.dmg.classList.remove('dir'); return; }
    // CSS 는 화면 위쪽이 0deg 라 라디안을 도로 바꿔서 그대로 넘긴다
    this.dmg.style.setProperty('--dir', `${(dir * 180 / Math.PI).toFixed(0)}deg`);
    this.dmg.classList.add('dir');
  }

  _setNum(key, v) {
    if (this._numCache[key] === v) return;
    this._numCache[key] = v;
    const el = this._nums[key];
    if (el) el.textContent = String(v);
  }

  /**
   * 노출도 — "지금 얼마나 들키기 쉬운가"를 하나의 값으로 보여 준다.
   * 소음 반경(자세)과 손전등 감지 배수를 곱해서 쓴다. 이 게임의 핵심 거래가
   * **손전등을 켤 것인가**인데, 지금까지 그 대가가 화면 어디에도 안 보였다.
   */
  _updateExposure({ player, flashlight, zombies }) {
    if (!this.exp) return;
    const noise = player.noiseRadius;
    const mul = flashlight.on ? FLASHLIGHT.detectionMultiplier : 1;
    const ratio = Math.min(1, (noise / NOISE.sprint) * mul);
    this.exp.style.transform = `scaleX(${ratio})`;
    this._setNum('exp', `${Math.round(noise * mul)}m`);
    this.expBar?.classList.toggle('warn', ratio >= STEALTH.warnAt && ratio < STEALTH.dangerAt);
    this.expBar?.classList.toggle('danger', ratio >= STEALTH.dangerAt);

    // 감지 상태 — 발각 > 경계 > 은폐. 스텔스에서 가장 알고 싶은 한 가지다
    let seen = false, heard = false;
    for (const z of zombies ?? []) {
      if (!z.active || z.state === 'DEAD') continue;
      if (z.state === 'CHASE' || z.state === 'ATTACK') { seen = true; break; }
      if (z.state === 'ALERT' || z.state === 'SEARCH') heard = true;
    }
    if (!this.expState) return;
    const label = seen ? '발각됨' : heard ? '경계' : 'EXPOSURE';
    if (this.expState.textContent !== label) this.expState.textContent = label;
    this.expState.classList.toggle('seen', seen);
    this.expState.classList.toggle('heard', !seen && heard);
  }

  update(dt, { player, flashlight, zombies }) {
    this._updateExposure({ player, flashlight, zombies });
    this.hp.style.transform = `scaleX(${player.hp / PLAYER.maxHp})`;
    this.stam.style.transform = `scaleX(${player.stamina / PLAYER.maxStamina})`;
    this.batt.style.transform = `scaleX(${flashlight.battery / FLASHLIGHT.maxBattery})`;

    // 숫자 표시 — 막대만으로는 "얼마나 남았나"를 어림만 할 수 있다.
    // 텍스트를 매 프레임 쓰면 레이아웃이 계속 다시 계산되므로 값이 바뀔 때만 쓴다.
    this._setNum('hp', Math.max(0, Math.round(player.hp)));
    this._setNum('stam', Math.max(0, Math.round(player.stamina)));
    this._setNum('batt', Math.max(0, Math.round(flashlight.battery)));

    // 위험 상태 맥동 — 숫자를 안 보고 있어도 눈에 걸린다
    this.hpBar?.classList.toggle('low', player.hp / PLAYER.maxHp < 0.35);
    this.battBar?.classList.toggle('low', flashlight.battery / FLASHLIGHT.maxBattery < 0.2);

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
    // 부상 상태를 글로도 알려준다 — 왜 느려졌는지 모르면 조작 버그로 오해한다
    const msg = flashlight.battery <= 0 ? '배터리 없음'
      : hpRatio < 0.25 ? '치명상 — 팔에 힘이 없다'
        : battLow ? '배터리 부족'
          : hpRatio < 0.5 ? '다리 부상 — 절뚝인다' : '';
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
