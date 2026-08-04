/**
 * AudioManager — WebAudio. 파일이 아직 없어도 게임이 죽지 않는다.
 * (에셋은 나중에 들어온다. ASSETS.md §4 순서 참조)
 *
 * 브라우저는 사용자 클릭 전에 소리를 못 낸다 → init() 은 시작 버튼에서 호출한다.
 */
import { bus, EV } from './EventBus.js';

const MANIFEST = {
  // 1순위 (ASSETS.md §4)
  footstep_1: 'sfx/sfx_footstep_concrete_01.ogg',
  footstep_2: 'sfx/sfx_footstep_concrete_02.ogg',
  footstep_3: 'sfx/sfx_footstep_concrete_03.ogg',
  footstep_4: 'sfx/sfx_footstep_concrete_04.ogg',
  zombie_groan: 'sfx/sfx_zombie_idle_groan_01.ogg',
  zombie_alert: 'sfx/sfx_zombie_alert.ogg',
  zombie_attack: 'sfx/sfx_zombie_attack.ogg',
  zombie_death: 'sfx/sfx_zombie_death.ogg',
  pistol_fire: 'sfx/sfx_pistol_fire.ogg',
  flashlight: 'sfx/sfx_flashlight_click.ogg',
  melee_swing: 'sfx/sfx_axe_swing.ogg',
  melee_hit: 'sfx/sfx_axe_hit_flesh.ogg',
  reload: 'sfx/sfx_reload_pistol.ogg',
  player_hurt: 'sfx/sfx_player_hurt.ogg',
  ambience: 'ambience/amb_hospital_hum.ogg',
};

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.missing = new Set();
    this.masterGain = null;
    this.listener = { x: 0, z: 0 };
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

  setListener(x, z) { this.listener.x = x; this.listener.z = z; }

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
      vol *= Math.max(0, 1 - dist / this.maxAudibleDistance) ** 1.7;
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = Math.max(-1, Math.min(1, dx / this.maxAudibleDistance * 2));
      gain.gain.value = vol;
      src.connect(gain); gain.connect(pan); pan.connect(this.masterGain);
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
