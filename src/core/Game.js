import * as THREE from 'three';
import { Input } from './Input.js';
import { Collision } from './Collision.js';
import { AudioManager } from './AudioManager.js';
import { bus, EV } from './EventBus.js';
import { FLASHLIGHT } from '../config/balance.js';
import { Atmosphere } from '../fx/Atmosphere.js';
import { PostFX } from '../fx/PostFX.js';
import { Player } from '../player/Player.js';
import { Flashlight } from '../player/Flashlight.js';
import { WeaponSystem } from '../weapons/WeaponSystem.js';
import { ZombiePool } from '../enemies/ZombiePool.js';
import { Director } from '../enemies/Director.js';
import { StageLoader } from '../world/StageLoader.js';
import { propModels } from '../world/PropModels.js';
import { Interaction } from '../world/Interaction.js';
import { HUD } from '../ui/HUD.js';
import * as hospitalA from '../world/stages/hospital_a.js';
import * as hospitalB from '../world/stages/hospital_b.js';
import * as hospitalC from '../world/stages/hospital_c.js';
import * as hospitalD from '../world/stages/hospital_d.js';
import * as hospitalRoof from '../world/stages/hospital_roof.js';

/**
 * 구역 진행 순서. 마지막 구역의 출구에 닿아야 클리어다.
 * 1F 격리병동 → B1 영안실 → 2F 병동 → 3F 수술부 → 옥상(탈출)
 */
const STAGES = [hospitalA, hospitalB, hospitalC, hospitalD, hospitalRoof];

/**
 * Game — 시스템 조립과 루프만 담당한다. 게임 규칙은 각 시스템에 있다.
 */
export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = 'IDLE';      // IDLE | PLAYING | PAUSED | DEAD | CLEAR
    this.elapsed = 0;

    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 120);
    this.scene.add(this.camera);           // 뷰모델이 카메라 자식이라 필요하다

    this.clock = new THREE.Clock();
    this.input = new Input(canvas);
    this.collision = new Collision();
    this.audio = new AudioManager();
    // 벽 너머 소리는 먹먹해야 한다 — 어디서 나는지 헷갈리는 게 공포다
    this.audio.occlusionTest = (x, z) =>
      this.collision.segmentBlocked(this.player.pos.x, this.player.pos.z, x, z);
    this.atmosphere = new Atmosphere(this.scene, this.renderer);
    this.post = new PostFX(this.renderer, this.scene, this.camera);
    this.hud = new HUD();

    this.player = new Player(this.camera, this.input, this.collision);
    this.flashlight = new Flashlight(this.camera, this.scene);
    this.pool = new ZombiePool(this.scene);
    this.director = new Director(this.pool, this.player, this.collision);
    this.weapons = new WeaponSystem(
      this.camera, this.scene, this.player, this.collision,
      () => this.pool.getActive()
    );
    this.interaction = new Interaction();
    this.stageLoader = new StageLoader(
      this.scene, this.collision, this.atmosphere, this.director, this.interaction
    );

    bus.on(EV.SFX, () => {});   // AudioManager 가 구독 중 (파일 없으면 무시됨)
    bus.on(EV.PLAYER_DIED, () => this.onDeath());

    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'PLAYING') this.pause();
    };

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();

    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post?.setSize(w, h);
  }

  /** 디버그·QA 용 — 콘솔에서 `game.stages[i]` 로 개별 구역을 바로 열어볼 수 있다 */
  get stages() { return STAGES; }

  /**
   * 시작 화면 배경 — 실제 구역을 띄워 놓고 손전등이 복도를 훑게 한다.
   * 검은 화면에 글자만 얹는 것보다, 게임이 이미 살아 움직이는 걸 보여주는 편이
   * 훨씬 강하다. 좀비는 띄우지 않는다(첫인상은 정적이어야 한다).
   * 소리는 못 낸다 — 브라우저가 사용자 클릭 전 재생을 막는다.
   */
  startAttract() {
    this.stageLoader.load(STAGES[0]);
    this.pool.despawnAll();
    this.flashlight.on = true;
    this.flashlight.battery = FLASHLIGHT.maxBattery;
    this._attractT = 0;
    // 손에 든 무기는 안 보이게 — 시작 화면은 "장소"를 보여주는 자리다
    this.weapons.viewRoot.visible = false;
    this.state = 'TITLE';
  }

  _updateAttract(dt) {
    this._attractT += dt;
    const t = this._attractT;
    const cam = this.camera;
    cam.rotation.order = 'YXZ';
    // 복도를 아주 느리게 오가며 좌우로 훑는다. 전부 sin 이라 끊기는 지점이 없다.
    // 시선 폭이 넓으면 벽·소품이 화면을 꽉 채워 답답하다. 복도 깊이가 보이도록 좁게 훑는다.
    cam.position.set(Math.sin(t * 0.09) * 0.5, 1.63 + Math.sin(t * 0.5) * 0.015,
      21 + Math.sin(t * 0.05) * 8);
    cam.rotation.set(-0.015 + Math.sin(t * 0.08) * 0.02, Math.PI + Math.sin(t * 0.11) * 0.26, 0);
    cam.updateMatrixWorld(true);
    this.flashlight.update(dt);
    this.atmosphere.update(dt);
  }

  async start() {
    await this.audio.init();
    // 소품 GLB 는 스테이지를 짓기 전에 다 읽혀 있어야 한다 (조립이 동기라서).
    // 실패해도 절차적 소품으로 되돌아가므로 게임은 진행된다.
    await propModels.preload();
    // 시작 무기는 Game 생성 시점(모델 로드 전)에 만들어졌다 — 여기서 GLB 로 다시 만든다
    this.weapons.refreshViewModel();
    this.audio.playAmbience();
    this.restart();
  }

  restart() {
    this.stageIndex = 0;
    this.weapons.viewRoot.visible = true;   // 시작 화면에서 숨겨 놓았다
    this.pool.despawnAll();
    const start = this.stageLoader.load(STAGES[0]);
    this.player.surfaceAt = this.stageLoader.surfaceAt;
    this.player.spawn(start.x, start.z, start.yaw);
    this.flashlight.battery = 100;
    this.flashlight.on = false;
    this.elapsed = 0;
    this.state = 'PLAYING';
    this.input.enabled = true;
    this.input.requestLock();
    this.hud.show();
    this.weapons._emitAmmo();
    bus.emit(EV.HINT, { text: 'F 를 눌러 손전등을 켜라', duration: 4 });
  }

  /** 다음 구역으로. 체력·배터리는 이어진다 — 구역을 넘는 게 회복 기회가 되면 긴장이 죽는다 */
  _nextStage() {
    const hp = this.player.hp;
    const battery = this.flashlight.battery;
    this.stageIndex++;
    this.pool.despawnAll();
    const stage = STAGES[this.stageIndex];
    const start = this.stageLoader.load(stage);
    this.player.surfaceAt = this.stageLoader.surfaceAt;
    this.player.spawn(start.x, start.z, start.yaw);
    this.player.hp = hp;
    this.flashlight.battery = battery;
    bus.emit(EV.HINT, { text: stage.meta?.label ?? '', duration: 4 });
  }

  pause() {
    if (this.state !== 'PLAYING') return;
    this.state = 'PAUSED';
    this.input.enabled = false;
    document.getElementById('pause')?.classList.remove('hide');
  }

  resume() {
    if (this.state !== 'PAUSED') return;
    document.getElementById('pause')?.classList.add('hide');
    this.state = 'PLAYING';
    this.input.enabled = true;
    this.input.requestLock();
  }

  onDeath() {
    if (this.state === 'DEAD') return;
    this.state = 'DEAD';
    this.input.enabled = false;
    this.input.releaseLock();
    this.hud.hide();
    const over = document.getElementById('over');
    // 제목을 매번 되돌린다 — onClear 가 'EXTRACTED'(초록)로 바꿔 놓기 때문에,
    // 한 번 탈출한 뒤 다시 시작해 죽으면 초록 EXTRACTED 가 그대로 뜬다
    const h1 = over?.querySelector('h1');
    if (h1) { h1.textContent = 'SIGNAL LOST'; h1.style.color = ''; }
    const sub = document.getElementById('over-sub');
    if (sub) {
      const label = STAGES[this.stageIndex]?.meta?.label ?? '';
      sub.textContent = `${label} · 생존 시간 ${this._formatTime(this.elapsed)}`;
    }
    over?.classList.remove('hide');
  }

  onClear() {
    if (this.state === 'CLEAR') return;
    this.state = 'CLEAR';
    this.input.enabled = false;
    this.input.releaseLock();
    this.hud.hide();
    const over = document.getElementById('over');
    over.querySelector('h1').textContent = 'EXTRACTED';
    over.querySelector('h1').style.color = '#6f8a63';
    document.getElementById('over-sub').textContent = `탈출 완료 · ${this._formatTime(this.elapsed)}`;
    over.classList.remove('hide');
  }

  _formatTime(s) {
    const m = Math.floor(s / 60);
    return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  }

  _loop() {
    requestAnimationFrame(this._loop);
    const dt = Math.min(0.05, this.clock.getDelta());   // 프레임 급락 시 물리 폭주 방지

    if (this.state === 'PLAYING') {
      this.elapsed += dt;
      this.player.update(dt);
      if (this.input.justPressed('KeyF')) this.flashlight.toggle();
      this.flashlight.update(dt);
      this.weapons.update(dt, this.input);

      this.pool.update(dt, {
        player: this.player,
        collision: this.collision,
        detectionMul: this.flashlight.detectionMultiplier,
      });
      this.director.update(dt);
      this.atmosphere.update(dt);

      // 상호작용 — 사거리 안 대상이 있으면 안내를 띄우고, E 로 사용한다
      this.interaction.update(dt);
      const target = this.interaction.findTarget(this.player.pos.x, this.player.pos.z);
      // 포인터락이 안 걸리면 마우스 시야가 아예 안 돈다. 그 사실을 먼저 알려야 한다 —
      // 안 그러면 "WASD 는 되는데 조작이 이상하다" 로만 보인다.
      this.hud.setPrompt(
        !this.input.locked ? '화면을 클릭해서 마우스를 잡아라'
          : target ? target.prompt({ player: this.player, flashlight: this.flashlight })
            : null
      );
      if (target && this.input.justPressed('KeyE')) {
        this.hud.setPrompt(null);   // 먼저 지운다 — 안 그러면 획득 메시지가 안내에 가려진다
        this.interaction.use(target, { player: this.player, flashlight: this.flashlight });
      }

      this.audio.setListener(this.player.pos.x, this.player.pos.z, this.player.yaw);
      this.hud.update(dt, { player: this.player, flashlight: this.flashlight });
      if (this.input.justPressed('Backquote')) this.hud.toggleDebug();
      this.hud.updateDebug({
        input: this.input, player: this.player, dt,
        renderer: this.renderer, zombies: this.pool.activeCount,
      });

      // 탈출 판정
      const ex = this.stageLoader.exit;
      if (ex) {
        const d = Math.hypot(this.player.pos.x - ex.x, this.player.pos.z - ex.z);
        if (d < ex.radius) {
          if (this.stageIndex < STAGES.length - 1) this._nextStage();
          else this.onClear();
        }
      }
    }

    if (this.state === 'TITLE') this._updateAttract(dt);

    if (this.post.enabled) this.post.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  }
}
