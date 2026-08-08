/**
 * AudioManager — WebAudio. 파일이 아직 없어도 게임이 죽지 않는다.
 * (에셋은 나중에 들어온다. ASSETS.md §4 순서 참조)
 *
 * 브라우저는 사용자 클릭 전에 소리를 못 낸다 → init() 은 시작 버튼에서 호출한다.
 */
import { bus, EV } from './EventBus.js';

const MANIFEST = {
  // 1순위 (ASSETS.md §4)
  // 바닥 재질별 발소리. 키 규칙: footstep_<재질>_<번호>
  footstep_concrete_1: 'sfx/sfx_footstep_concrete_01.mp3',
  footstep_concrete_2: 'sfx/sfx_footstep_concrete_02.mp3',
  footstep_concrete_3: 'sfx/sfx_footstep_concrete_03.mp3',
  footstep_concrete_4: 'sfx/sfx_footstep_concrete_04.mp3',
  footstep_tile_1: 'sfx/sfx_footstep_tile_01.mp3',
  footstep_tile_2: 'sfx/sfx_footstep_tile_02.mp3',
  footstep_tile_3: 'sfx/sfx_footstep_tile_03.mp3',
  footstep_tile_4: 'sfx/sfx_footstep_tile_04.mp3',
  footstep_debris_1: 'sfx/sfx_footstep_debris_01.mp3',
  footstep_debris_2: 'sfx/sfx_footstep_debris_02.mp3',
  footstep_debris_3: 'sfx/sfx_footstep_debris_03.mp3',
  footstep_wet_1: 'sfx/sfx_footstep_wet_01.mp3',
  footstep_wet_2: 'sfx/sfx_footstep_wet_02.mp3',
  zombie_groan_1: 'sfx/sfx_zombie_idle_groan_01.mp3',
  zombie_groan_2: 'sfx/sfx_zombie_idle_groan_02.mp3',
  zombie_groan_3: 'sfx/sfx_zombie_idle_groan_03.mp3',
  zombie_scream_1: 'sfx/sfx_zombie_scream_01.mp3',
  zombie_scream_2: 'sfx/sfx_zombie_scream_02.mp3',
  zombie_notice: 'sfx/sfx_zombie_notice.mp3',
  // 피격 — 무기 종류와 부위에 따라 다르게
  hit_flesh_1: 'sfx/sfx_hit_flesh_01.mp3',
  hit_flesh_2: 'sfx/sfx_hit_flesh_02.mp3',
  hit_blunt_1: 'sfx/sfx_hit_blunt_01.mp3',
  hit_blunt_2: 'sfx/sfx_hit_blunt_02.mp3',
  hit_headshot: 'sfx/sfx_hit_headshot.mp3',
  zombie_alert: 'sfx/sfx_zombie_alert.mp3',
  zombie_attack: 'sfx/sfx_zombie_attack.mp3',
  zombie_death: 'sfx/sfx_zombie_death.mp3',
  pistol_fire: 'sfx/sfx_pistol_fire.mp3',
  flashlight: 'sfx/sfx_flashlight_click.mp3',
  melee_swing: 'sfx/sfx_axe_swing.mp3',
  melee_hit: 'sfx/sfx_axe_hit_flesh.mp3',
  reload: 'sfx/sfx_reload_pistol.mp3',
  player_hurt: 'sfx/sfx_player_hurt.mp3',

  // ── 1인칭 플레이어 목소리 (2026-08-08) ──────────────────────────────────
  // 그전까지 플레이어가 내는 소리는 위의 player_hurt 하나뿐이었다. 좀비는 8종을
  // 내는데 플레이어는 맞을 때 한 번 끙 하고 마는, 몸이 없는 카메라였다.
  //
  // **여기 등록만 해서는 게임에 없는 것이다** (PROGRESS.md 함정 — zombie_notice 가
  // 두 세션 동안 등록만 되고 한 번도 안 울렸다). 부르는 곳을 반드시 같이 만든다:
  //   effort   → WeaponAttack._swingMelee  (근접을 휘두를 때, 확률적으로)
  //   grabbed  → Player.beginGrab          (물린 순간)
  //   struggle → Player._grabbed           (뿌리치려 몸부림칠 때)
  //   breath   → Player._stamina           (스태미나가 바닥났을 때)
  //   pain     → Player._syncCamera        (크게 다친 채로 숨 쉴 때)
  //   hurt_2/3 → Player.hurt               (기존 hurt 와 번갈아)
  player_effort_1: 'sfx/sfx_player_effort_01.mp3',
  player_effort_2: 'sfx/sfx_player_effort_02.mp3',
  player_effort_3: 'sfx/sfx_player_effort_03.mp3',
  player_grabbed: 'sfx/sfx_player_grabbed.mp3',
  player_struggle_1: 'sfx/sfx_player_struggle_01.mp3',
  player_struggle_2: 'sfx/sfx_player_struggle_02.mp3',
  player_breath_1: 'sfx/sfx_player_breath_01.mp3',
  player_breath_2: 'sfx/sfx_player_breath_02.mp3',
  player_pain_1: 'sfx/sfx_player_pain_01.mp3',
  player_pain_2: 'sfx/sfx_player_pain_02.mp3',
  player_hurt_2: 'sfx/sfx_player_hurt_02.mp3',
  player_hurt_3: 'sfx/sfx_player_hurt_03.mp3',

  // ── 투척·화염병 (2026-08-08) ──────────────────────────────────────────
  //   throw_whoosh  → WeaponAttack._throw   (던지는 순간)
  //   molotov_break → Throwables._land      (병이 깨지며 불이 붙는 순간)
  //   fire_loop     → Throwables._burn      (타는 8초 동안, loop() 로 자리에 물린다)
  throw_whoosh: 'sfx/sfx_throw_whoosh.mp3',
  molotov_break: 'sfx/sfx_molotov_break.mp3',
  fire_loop: 'sfx/sfx_fire_loop.mp3',
  //   radio_static  → Throwables._land      (라디오가 떨어져 켜지는 순간)
  radio_static: 'sfx/sfx_radio_static.mp3',

  ambience: 'ambience/amb_hospital_hum.mp3',
};

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.missing = new Set();
    this.masterGain = null;
    this.listener = { x: 0, z: 0, yaw: 0 };
    /** 벽 차폐 판정 — Game 이 넣어준다. (x,z) => boolean */
    this.occlusionTest = null;
    this.ready = false;
    this.maxAudibleDistance = 30;

    bus.on(EV.SFX, (p) => this.play(p.name, p));
  }

  /** 사용자 제스처 안에서 호출할 것 */
  async init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.85;
    this.masterGain.connect(this.ctx.destination);

    await Promise.all(
      Object.entries(MANIFEST).map(([key, path]) => this._load(key, path))
    );
    this.ready = true;

    const n = this.buffers.size;
    if (n === 0) {
      console.info('[audio] 아직 사운드 파일이 없습니다. ASSETS.md §4 목록을 만들어 public/assets/audio/ 에 넣으세요.');
    } else {
      console.info(`[audio] ${n}/${Object.keys(MANIFEST).length} 로드됨`);
    }
  }

  async _load(key, path) {
    try {
      const res = await fetch(`assets/audio/${path}`);
      if (!res.ok) throw new Error(String(res.status));
      const buf = await res.arrayBuffer();
      this.buffers.set(key, await this.ctx.decodeAudioData(buf));
    } catch {
      this.missing.add(key);   // 조용히 넘어간다 — 없는 게 정상인 시기가 있다
    }
  }

  setListener(x, z, yaw = 0) {
    this.listener.x = x; this.listener.z = z; this.listener.yaw = yaw;
  }

  /**
   * 청자 기준 거리 감쇠·차폐·저역통과·좌우 패닝을 한 번에 계산한다.
   * `play()` 와 `loop()` 가 같이 쓴다 — 한쪽만 고치면 일회성 소리와 이어지는 소리의
   * 거리감이 달라져서, 같은 불웅덩이가 소리마다 다른 곳에 있는 것처럼 들린다.
   * @returns null 이면 너무 멀어 안 들린다
   */
  _spatial(x, z, vol) {
    const dx = x - this.listener.x;
    const dz = z - this.listener.z;
    const dist = Math.hypot(dx, dz);
    if (dist > this.maxAudibleDistance) return null;

    const t = dist / this.maxAudibleDistance;
    // 역제곱에 가까운 감쇠 — 선형보다 "멀다"가 잘 읽힌다
    vol *= (1 - t) ** 2 * 0.92 + (1 - t) * 0.08;
    // 벽 너머면 더 작고 훨씬 먹먹하게. 이게 있어야 "어디선가" 들리는 느낌이 난다
    const occluded = this.occlusionTest ? this.occlusionTest(x, z) : false;
    if (occluded) vol *= 0.42;
    // 거리에 따른 저역 통과 — 고음이 먼저 죽는다. 거리감의 8할이 여기서 나온다
    const openness = (1 - t) ** 1.6;
    const freq = Math.max(320, 380 + openness * 17000) * (occluded ? 0.16 : 1);
    // 좌우 패닝은 청자가 **바라보는 방향** 기준이어야 한다.
    // 월드 X 로 하면 몸을 돌려도 소리가 같은 쪽에서 난다.
    const sn = Math.sin(this.listener.yaw), cs = Math.cos(this.listener.yaw);
    const right = dx * cs - dz * sn;
    const pan = Math.max(-1, Math.min(1, right / Math.max(dist, 0.6)));
    return { vol, freq, pan };
  }

  /**
   * @param {string} name  MANIFEST 키
   * @param {{x?:number, z?:number, volume?:number, rate?:number}} opt
   *        x,z 를 주면 거리 감쇠 + 좌우 패닝이 적용된다.
   */
  play(name, opt = {}) {
    if (!this.ready || !this.buffers.has(name)) return;
    const buffer = this.buffers.get(name);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = opt.rate ?? (0.94 + Math.random() * 0.12);

    const gain = this.ctx.createGain();
    let vol = opt.volume ?? 1;

    if (opt.x !== undefined && opt.z !== undefined) {
      const sp = this._spatial(opt.x, opt.z, vol);
      if (!sp) return;                               // 너무 멀다
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = sp.freq;
      filter.Q.value = 0.6;
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = sp.pan;
      gain.gain.value = sp.vol;
      src.connect(filter); filter.connect(gain); gain.connect(pan); pan.connect(this.masterGain);
    } else {
      gain.gain.value = vol;
      src.connect(gain); gain.connect(this.masterGain);
    }
    src.start(0);
  }

  /**
   * 이어지는 소리 — 불웅덩이처럼 **한동안 그 자리에서 나는** 것.
   *
   * `play()` 로는 안 된다. 그건 한 번 울리고 끝이라 플레이어가 돌아서거나 멀어져도
   * 소리가 따라오지 않는다. 불이 8초를 타는 동안 그 위치에서 계속 들려야
   * "저쪽이 타고 있다"가 귀로 읽힌다.
   *
   * 돌려주는 손잡이의 `at(x, z)` 를 **매 프레임 부른다** — 청자가 움직이므로
   * 불이 제자리에 있어도 감쇠·패닝은 계속 바뀐다.
   * @returns 손잡이. 파일이 없거나 오디오가 아직이면 null
   */
  loop(name, { x, z, volume = 1 }) {
    if (!this.ready || !this.buffers.has(name)) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers.get(name);
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.6;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;              // 첫 at() 이 정한다. 0 에서 시작해야 안 튄다
    const pan = this.ctx.createStereoPanner();
    src.connect(filter); filter.connect(gain); gain.connect(pan); pan.connect(this.masterGain);
    src.start(0);

    const h = {
      base: volume,
      at: (nx, nz, scale = 1) => {
        const sp = this._spatial(nx, nz, h.base * scale);
        // 너무 멀면 **끄지 않고 볼륨만 0** 으로 둔다. 다시 다가오면 살아나야 한다
        gain.gain.value = sp ? sp.vol : 0;
        if (sp) { filter.frequency.value = sp.freq; pan.pan.value = sp.pan; }
      },
      stop: () => { try { src.stop(); } catch { /* 이미 멈췄다 */ } },
    };
    h.at(x, z);
    return h;
  }

  playAmbience() {
    if (!this.ready || !this.buffers.has('ambience') || this._amb) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers.get('ambience');
    src.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.4;
    src.connect(gain); gain.connect(this.masterGain);
    src.start(0);
    this._amb = src;
  }

  stopAmbience() { this._amb?.stop(); this._amb = null; }
}
