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
      const dx = opt.x - this.listener.x;
      const dz = opt.z - this.listener.z;
      const dist = Math.hypot(dx, dz);
      if (dist > this.maxAudibleDistance) return;

      const t = dist / this.maxAudibleDistance;
      // 역제곱에 가까운 감쇠 — 선형보다 "멀다"가 잘 읽힌다
      vol *= (1 - t) ** 2 * 0.92 + (1 - t) * 0.08;

      // 벽 너머면 더 작고 훨씬 먹먹하게. 이게 있어야 "어디선가" 들리는 느낌이 난다
      const occluded = this.occlusionTest ? this.occlusionTest(opt.x, opt.z) : false;
      if (occluded) vol *= 0.42;

      // 거리에 따른 저역 통과 — 고음이 먼저 죽는다. 거리감의 8할이 여기서 나온다
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      const openness = (1 - t) ** 1.6;
      filter.frequency.value = Math.max(320, 380 + openness * 17000) * (occluded ? 0.16 : 1);
      filter.Q.value = 0.6;

      // 좌우 패닝은 청자가 바라보는 방향 기준이어야 한다.
      // 월드 X 로 하면 몸을 돌려도 소리가 같은 쪽에서 난다.
      const s = Math.sin(this.listener.yaw), c = Math.cos(this.listener.yaw);
      const right = dx * c - dz * s;                 // 청자 기준 오른쪽 성분
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = Math.max(-1, Math.min(1, right / Math.max(dist, 0.6)));

      gain.gain.value = vol;
      src.connect(filter); filter.connect(gain); gain.connect(pan); pan.connect(this.masterGain);
    } else {
      gain.gain.value = vol;
      src.connect(gain); gain.connect(this.masterGain);
    }
    src.start(0);
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
