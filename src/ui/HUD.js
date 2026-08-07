import { PLAYER, FLASHLIGHT, NOISE, STEALTH, HUD_FX } from '../config/balance.js';
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
      /* 심박 — 사인파 한 번은 심박이 아니라 호흡이다. 실제 심장은 "두근–쿵–쉼" 이라
         두 번 몰아친 뒤 쉬어야 몸이 반응한다. 속도(--hb)는 체력에서 나온다:
         예전에는 HP 39% 와 3% 가 똑같은 속도로 맥동해서 죽기 직전이라는 정보가 없었다. */
      #vig.on{animation:heartbeat var(--hb,.95s) ease-in-out infinite}
      @keyframes heartbeat{
        0%{opacity:.20}  7%{opacity:.80} 15%{opacity:.32}
        23%{opacity:.62} 33%{opacity:.22} 100%{opacity:.20}}
      /* 계기판 활자로 통일한다. 등폭 볼드는 콘솔·디버그의 활자라, 가장 몰입이
         필요한 두 순간(치명상·물림)에 UI 가 "웹페이지"로 되돌아갔다.
         굵기 대신 자간과 색으로 세기를 만든다. */
      #warn{position:fixed;left:50%;top:16%;transform:translateX(-50%);z-index:6;
        font:400 12.5px/1 var(--ui);letter-spacing:.34em;color:#c8503c;
        opacity:0;transition:opacity .2s;pointer-events:none;text-shadow:0 0 12px rgba(200,60,40,.7)}
      #warn.on{animation:blink .9s steps(1) infinite}
      @keyframes blink{0%,55%{opacity:.95}56%,100%{opacity:.15}}
      #bars .bar{transition:box-shadow .3s}
      #bars .bar.crit{box-shadow:0 0 10px rgba(210,50,36,.85)}
      /* HUD.js 가 주입하는 CSS 에도 감속 모드 가드가 필요하다 — index.html 은
         네 군데에서 지키는데 여기만 빠져 있었다. 150bpm 심박은 어지럼을 유발한다 */
      @media (prefers-reduced-motion:reduce){
        #vig.on,#warn.on,#grab.on{animation:none}
        #vig.on{opacity:.5}}

      /* 물림 — 화면 가장자리가 붉게 조여들고, 아래에 뿌리치기 게이지가 뜬다.
         숫자가 아니라 **차오르는 것**이어야 연타할 마음이 든다. */
      /* inset:-4px — 흔들 때 2px 밀리므로 0 이면 오른쪽·아래에 안 물든 띠가 생긴다 */
      #grab{position:fixed;inset:-4px;pointer-events:none;z-index:7;opacity:0;
        transition:opacity .12s;
        background:radial-gradient(ellipse at center,transparent 24%,rgba(120,10,8,.92) 96%)}
      #grab.on{opacity:1;animation:grabshake .16s steps(2) infinite}
      @keyframes grabshake{0%{transform:translate(0,0)}50%{transform:translate(2px,-2px)}}
      #grabui{position:fixed;left:50%;bottom:21%;transform:translateX(-50%);z-index:8;
        width:min(320px,42vw);opacity:0;transition:opacity .12s;pointer-events:none;text-align:center}
      #grabui.on{opacity:1}
      #grabui .lb{font:400 13.5px/1 var(--ui);letter-spacing:.32em;color:#f0d8d4;
        text-shadow:0 0 14px rgba(220,60,40,.9);margin-bottom:9px}
      /* 일시정지 화면의 키캡과 같은 어휘를 쓴다 — 같은 장치가 말하는 것으로 읽혀야 한다 */
      #grabui .lb b{font-weight:400;color:#ffd34a;border:1px solid rgba(255,211,74,.45);
        padding:2px 7px;margin-right:6px}
      #grabui .track{height:9px;background:rgba(0,0,0,.62);border:1px solid #6b2420;
        box-shadow:0 0 14px rgba(200,40,30,.5)}
      /* **width 가 아니라 scaleX 다.** 이 프로젝트가 로딩 막대에 직접 써 놓은 규칙인데
         (index.html) 물림 게이지만 안 지키고 있었다 — 하필 화면 전체가 흔들리고
         좀비가 붙어 있는, 프레임이 가장 아까운 순간에 매 프레임 레이아웃을 다시 쟀다. */
      #grabui .fill{height:100%;width:100%;transform:scaleX(0);transform-origin:left;
        background:linear-gradient(90deg,#c8503c,#ffd34a);will-change:transform}
      /* 제한 시간 — 못 뿌리치면 큰 피해를 받는데(GRAB.breakDamage) 얼마나 남았는지가
         화면에 전혀 없었다. "차오르는 것"만 있고 "줄어드는 것"이 없으면 다급함이 안 산다. */
      #grabui .clock{height:2px;margin-top:6px;background:rgba(0,0,0,.55)}
      #grabui .clock>i{display:block;height:100%;background:#8e2b26;
        transform:scaleX(1);transform-origin:left}
      #grabui.urgent .clock>i{animation:vitalPulse .4s ease-in-out infinite}
      @media (prefers-reduced-motion:reduce){#grabui.urgent .clock>i{animation:none}}
    `;
    document.head.appendChild(css);
    this.vig = document.createElement('div'); this.vig.id = 'vig';
    this.warn = document.createElement('div'); this.warn.id = 'warn';
    this.grabVig = document.createElement('div'); this.grabVig.id = 'grab';
    this.grabUI = document.createElement('div'); this.grabUI.id = 'grabui';
    this.grabUI.innerHTML = '<div class="lb"><b>SPACE</b> 연타해서 뿌리쳐라</div>'
      + '<div class="track"><div class="fill"></div></div>'
      + '<div class="clock"><i></i></div>';
    this.grabFill = this.grabUI.querySelector('.fill');
    this.grabClock = this.grabUI.querySelector('.clock > i');
    document.body.append(this.vig, this.warn, this.grabVig, this.grabUI);
    this._grabOn = false;
    // 숫자 표시 — 값이 바뀔 때만 DOM 을 건드린다
    this._nums = {
      hp: document.getElementById('hp-n'),
      stam: document.getElementById('stam-n'),
      batt: document.getElementById('batt-n'),
      exp: document.getElementById('exp-n'),
    };
    this._numCache = {};
    // 인라인 스타일 쓰기 캐시 — 값이 안 바뀌면 건드리지 않는다.
    // 예전에는 서 있기만 해도 매 프레임 8회를 썼고, 게다가 `scaleX(0.9310344827586207)`
    // 같은 17자리 문자열을 매번 만들어 CSSOM 파서를 태웠다.
    this._styleCache = {};
    this.crosshair = document.getElementById('crosshair');
    this.hpBar = document.getElementById('hp');
    this.hpGhost = document.querySelector('#hp > u');
    this.battBar = document.getElementById('batt');
    this.ammoBox = document.getElementById('ammo');       // setAmmo 가 매 발사마다 조회하던 것
    this.hitmark = document.getElementById('hitmark');
    this.reloadRing = document.getElementById('reload');
    this.dirSlots = [...document.querySelectorAll('#hitdir > i')];
    this._dirI = 0;
    this._spread = 0; this._spreadStr = '';
    this._markKind = null; this._markT = 0;

    // 연출 시간을 CSS 로 **한 번만** 내려보낸다 (balance.js 가 원본이다)
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty('--ghost-delay', `${HUD_FX.ghostDelay}s`);
    rootStyle.setProperty('--ghost-fall', `${HUD_FX.ghostFall}s`);
    for (const el of this.dirSlots) el.style.setProperty('--life', `${HUD_FX.dirArcLife}s`);

    bus.on(EV.HINT, ({ text, duration = 2 }) => this.showHint(text, duration));
    bus.on(EV.PLAYER_DAMAGED, ({ dir }) => this.flashDamage(dir));
    bus.on(EV.OBJECTIVE, ({ text }) => this.setObjective(text));
    bus.on(EV.AMMO_CHANGED, (a) => this.setAmmo(a));
    bus.on(EV.WEAPON_CHANGED, ({ weapon }) => { this.ammoLabel.textContent = weapon.label; });
    // 타격 확인 — 어두워서 좀비가 잘 안 보이는 게임인데 지금까지 화면이
    // "맞혔는지"를 한 번도 말하지 않았다
    bus.on(EV.ZOMBIE_HIT, ({ headshot }) => this._mark(headshot ? 'head' : ''));
    bus.on(EV.ZOMBIE_DIED, () => this._mark('kill'));
    // 쏘면 조준점이 벌어진다 — 크로스헤어가 무기와 연결되는 유일한 통로다
    bus.on(EV.WEAPON_FIRED, () => {
      this._spread = Math.min(1, this._spread + HUD_FX.crossKick);
    });
    bus.on(EV.RELOAD_START, ({ seconds }) => this._reloadRing(seconds));
    bus.on(EV.RELOAD_END, () => this.reloadRing?.classList.remove('on'));
  }

  /**
   * 히트마커. 같은 프레임에 여러 번 들어와도(폭발·다중 명중) 한 번만 반영한다 —
   * className 을 연달아 갈아 끼우면 애니메이션이 매번 리셋돼 깜빡임만 남고,
   * `void offsetWidth` 가 그만큼 강제 동기 레이아웃을 일으킨다.
   * 킬이 뜬 뒤에는 일반 히트가 덮어쓰지 않는다.
   */
  _mark(kind) {
    const el = this.hitmark;
    if (!el) return;
    if (this._markKind === 'kill' && kind !== 'kill') return;
    this._markKind = kind;
    this._markT = kind === 'kill' ? HUD_FX.killFlash
      : kind === 'head' ? HUD_FX.headFlash : HUD_FX.hitFlash;
    el.className = '';
    void el.offsetWidth;                  // 애니메이션을 다시 태우는 수법 (setObjective 와 같다)
    el.className = kind ? `on ${kind}` : 'on';
  }

  /**
   * 재장전 링. 남은 시간을 트랜지션에 심어 두면 브라우저가 컴포지터에서 돌린다 —
   * 재장전 한 번에 스타일 쓰기 2회면 끝이고 매 프레임 JS 가 필요 없다.
   */
  _reloadRing(seconds) {
    const c = this.reloadRing?.querySelector('circle');
    if (!c) return;
    c.style.transition = 'none';
    c.style.strokeDashoffset = '100.53';
    void c.offsetWidth;
    c.style.transition = `stroke-dashoffset ${seconds}s linear`;
    this.reloadRing.classList.add('on');
  }

  show() { this.root.classList.add('on'); }
  hide() { this.root.classList.remove('on'); }

  setAmmo({ label, mag, reserve, melee, throwable }) {
    this.ammoLabel.textContent = label;
    // 근접만 ∞. 투척물은 예비탄이 없으니 개수 하나만 — "12 / 0" 은 재장전이 있는 것처럼 읽힌다
    this.ammoNum.innerHTML = melee ? '∞'
      : throwable ? `${mag}` : `${mag}<small> / ${reserve}</small>`;
    // 바닥나 가면 숫자가 붉어진다 — 재장전(또는 아껴 쓸) 타이밍을 눈으로 알 수 있어야 한다
    const low = !melee && mag <= (throwable ? HUD_FX.ammoLowThrow : HUD_FX.ammoLowMag);
    this.ammoBox?.classList.toggle('low', low);
    // 완전히 비면 "지금 못 쏜다"를 말해 준다. 숫자 색만으로는 부족하다
    this.ammoBox?.classList.toggle('empty', !melee && !throwable && mag === 0);
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
  /**
   * 물림 표시. `v` 가 음수면 안 물린 상태다.
   * DOM 은 **상태가 바뀔 때만** 건드린다 — 매 프레임 클래스를 넣었다 빼면 그것만으로 끊긴다.
   */
  setStruggle(v, left = 1) {
    const on = v >= 0;
    if (on !== this._grabOn) {
      this._grabOn = on;
      this.grabVig.classList.toggle('on', on);
      this.grabUI.classList.toggle('on', on);
    }
    if (!on) return;
    // width 가 아니라 scaleX — 매 프레임 레이아웃을 다시 재지 않는다
    this._setStyle(this.grabFill, 'grab', 'transform', `scaleX(${Math.min(1, v).toFixed(3)})`);
    this._setStyle(this.grabClock, 'grabclk', 'transform',
      `scaleX(${Math.max(0, Math.min(1, left)).toFixed(3)})`);
    this.grabUI.classList.toggle('urgent', left <= HUD_FX.grabUrgentAt);
  }

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

  /** @param {{input:object, player:object, dt:number, renderer:object, pool:object}} s */
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
      + `속도 ${s.player.speed.toFixed(2)} m/s   좀비 ${s.pool?.activeCount ?? 0}`;
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
    this._dmgTimer = HUD_FX.dmgFlash;
    if (dir == null) { this.dmg.style.removeProperty('--dir'); this.dmg.classList.remove('dir'); return; }
    // CSS 는 화면 위쪽이 0deg 라 라디안을 도로 바꿔서 그대로 넘긴다
    const deg = `${(dir * 180 / Math.PI).toFixed(0)}deg`;
    this.dmg.style.setProperty('--dir', deg);
    this.dmg.classList.add('dir');

    // 방위 호는 칸을 돌려 쓴다 — 앞뒤로 동시에 물리면 나중 것이 앞 것을 지우던 문제.
    // 붉은 물듦보다 오래 남는다: 고개를 돌리는 동안에도 보여야 정보다.
    const el = this.dirSlots[this._dirI];
    if (el) {
      this._dirI = (this._dirI + 1) % this.dirSlots.length;
      el.style.setProperty('--a', deg);
      el.classList.remove('on');
      void el.offsetWidth;
      el.classList.add('on');
    }
  }

  _setNum(key, v) {
    if (this._numCache[key] === v) return;
    this._numCache[key] = v;
    const el = this._nums[key];
    if (el) el.textContent = String(v);
  }

  /** 값이 바뀔 때만 인라인 스타일을 쓴다. key 는 명시적으로 넘긴다 (id 없는 요소가 있다) */
  _setStyle(el, key, prop, v) {
    if (!el || this._styleCache[key] === v) return;
    this._styleCache[key] = v;
    el.style[prop] = v;
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
    const hpRatio = player.hp / PLAYER.maxHp;
    // 잔상과 채움에 **같은 값**을 준다 — 늦게 따라오는 것은 CSS 의 delay 가 만든다.
    // 그래서 JS 쪽 상태가 하나도 안 늘어난다.
    const hpStr = `scaleX(${hpRatio.toFixed(3)})`;
    this._setStyle(this.hp, 'hp', 'transform', hpStr);
    this._setStyle(this.hpGhost, 'hpg', 'transform', hpStr);
    this._setStyle(this.stam, 'stam', 'transform',
      `scaleX(${(player.stamina / PLAYER.maxStamina).toFixed(3)})`);
    this._setStyle(this.batt, 'batt', 'transform',
      `scaleX(${(flashlight.battery / FLASHLIGHT.maxBattery).toFixed(3)})`);

    // 숫자 표시 — 막대만으로는 "얼마나 남았나"를 어림만 할 수 있다.
    // 텍스트를 매 프레임 쓰면 레이아웃이 계속 다시 계산되므로 값이 바뀔 때만 쓴다.
    this._setNum('hp', Math.max(0, Math.round(player.hp)));
    this._setNum('stam', Math.max(0, Math.round(player.stamina)));
    this._setNum('batt', Math.max(0, Math.round(flashlight.battery)));

    // 체력이 낮을수록 화면 가장자리가 심장처럼 뛴다.
    // 문턱을 하나로 합쳤다 — 예전에는 막대 맥동(0.35)과 가장자리(0.4)가 어긋나서
    // 그 사이 구간에서 두 신호가 엇갈렸다.
    const hurt = hpRatio < HUD_FX.hpHurtAt;
    this.hpBar?.classList.toggle('low', hurt);
    this.battBar?.classList.toggle('low', flashlight.battery / FLASHLIGHT.maxBattery < HUD_FX.battLowAt);
    if (hurt !== this._hurt) {
      this._hurt = hurt;
      this.vig.style.opacity = hurt ? '' : '0';
      this.vig.classList.toggle('on', hurt);
    }
    if (hurt) {
      // 빈사에 가까울수록 빨리 뛴다. 0.05초 단위로 끊어 값이 바뀔 때만 쓴다 —
      // 매 프레임 쓰면 애니메이션이 계속 재시작해 박자가 사라진다.
      const t = 1 - Math.min(1, hpRatio / HUD_FX.hpHurtAt);
      const bpm = HUD_FX.heartMinBpm + (HUD_FX.heartMaxBpm - HUD_FX.heartMinBpm) * t;
      const dur = (Math.round((60 / bpm) * 20) / 20).toFixed(2);
      if (dur !== this._hb) {
        this._hb = dur;
        // #vig 는 HUD 밖(body 직속)이고 #hp 는 HUD 안이라 둘 다 읽으려면 루트에 심는다
        document.documentElement.style.setProperty('--hb', `${dur}s`);
      }
    }
    this.hpBar?.classList.toggle('crit', hpRatio < HUD_FX.hpCritAt);

    // 배터리 경고 — 손전등이 이 게임의 생명줄이다
    const battRatio = flashlight.battery / FLASHLIGHT.maxBattery;
    const battLow = battRatio < HUD_FX.battLowAt;
    this.battBar?.classList.toggle('crit', battLow);
    // 부상 상태를 글로도 알려준다 — 왜 느려졌는지 모르면 조작 버그로 오해한다
    const msg = flashlight.battery <= 0 ? '배터리 없음'
      : hpRatio < HUD_FX.hpCritAt ? '치명상 — 팔에 힘이 없다'
        : battLow ? '배터리 부족'
          : hpRatio < HUD_FX.hpLimpAt ? '다리 부상 — 절뚝인다' : '';
    if (msg !== this._warnMsg) {
      this._warnMsg = msg;
      this.warn.textContent = msg;
      this.warn.classList.toggle('on', !!msg);
      this.warn.style.opacity = msg ? '' : '0';
    }

    // 크로스헤어 — 움직일수록·쏠수록 벌어지고 흐려진다 (정지 사격을 유도).
    // CSS 트랜지션 대신 여기서 지수 보간한다: 트랜지션을 걸어 놓고 매 프레임
    // 덮어쓰면 목표에 영영 도달하지 못한 채 상시 0.12초 뒤처진다.
    if (this.crosshair) {
      const target = Math.min(1, player.speed / PLAYER.speedSprint);
      // 발사 반동은 목표보다 위로 튈 수 있다 — 위에서 아래로 잦아들게 둔다
      const to = Math.max(target, 0);
      this._spread += (to - this._spread) * Math.min(1, dt * HUD_FX.crossLerp);
      const s = this._spread.toFixed(3);
      if (s !== this._spreadStr) {
        this._spreadStr = s;
        this.crosshair.style.setProperty('--s', s);
      }
    }

    // 히트마커 정리 — 시간이 지나면 '킬' 잠금을 푼다
    if (this._markT > 0) {
      this._markT -= dt;
      if (this._markT <= 0) this._markKind = null;
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
