import * as THREE from 'three';
import { Input } from './Input.js';
import { Collision } from './Collision.js';
import { AudioManager } from './AudioManager.js';
import { bus, EV } from './EventBus.js';
import { FLASHLIGHT, PLAYER, PERF, SHAKE, CHECKPOINT, DEATH } from '../config/balance.js';
import { Atmosphere } from '../fx/Atmosphere.js';
import { PostFX } from '../fx/PostFX.js';
import { Impact } from '../fx/Impact.js';
import { Player } from '../player/Player.js';
import { Flashlight } from '../player/Flashlight.js';
import { WeaponSystem } from '../weapons/WeaponSystem.js';
import { preloadSwingCurves } from '../weapons/SwingCurves.js';
import { ZombiePool } from '../enemies/ZombiePool.js';
import { Director } from '../enemies/Director.js';
import { StageLoader } from '../world/StageLoader.js';
import { propModels } from '../world/PropModels.js';
import { Interaction } from '../world/Interaction.js';
import { BloodDecals } from '../world/Scatter.js';
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

    // antialias 는 PERF.canvasMsaa 를 따른다 — 후처리가 켜져 있으면 캔버스 MSAA 는
    // 화면을 덮는 사각형 하나에만 걸려서 한 픽셀도 개선하지 못하면서 백버퍼 46MB 를
    // 잡고 매 프레임 리졸브한다 (balance.js PERF.canvasMsaa 주석 참조).
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: PERF.canvasMsaa, powerPreference: 'high-performance',
    });
    // 심사자 PC 를 고를 수 없다 — 해상도를 낮게 시작하고, 프레임을 보며 스스로 조정한다.
    // 천장(pixelRatioMax)에서 시작하지 않는 이유: 약한 PC 가 첫 몇 초를 버벅이며 연다.
    // 첫인상은 그걸로 끝나므로, 낮게 열고 여유가 확인되면 올린다.
    this._dprCap = Math.min(PERF.pixelRatioStart, PERF.pixelRatioMax);
    this.renderer.setPixelRatio(this._dprCap);
    this._frameAcc = 0; this._frameN = 0; this._adaptT = 0;
    // 루프가 시스템에 넘기는 인자 묶음. **매 프레임 새로 만들지 않는다.**
    // 리터럴 세 개면 초당 180개가 신세대 힙에 쌓이고, 하필 전투 중처럼
    // 좀비·입자·데칼이 같이 도는 순간에 마이너 GC 를 앞당긴다. 필드만 갈아 끼운다.
    this._poolCtx = {};
    this._hudCtx = {};
    this._dbgCtx = {};
    // 근접이 닿는 순간 세상이 잠깐 걸린다 (SHAKE.hitStop)
    this._hitStop = 0;
    bus.on(EV.MELEE_HIT, () => { this._hitStop = SHAKE.hitStop; });
    // 벽·소품을 쳤을 때는 더 짧게. 살처럼 파고들지 않고 튕겨 나와야 한다
    bus.on(EV.MELEE_CLANG, () => { this._hitStop = SHAKE.hitStopWall; });
    // 죽는 순간에도 화면이 걸린다. 예전에는 히트스톱이 근접에만 걸려 있어서
    // **총으로 죽이면 화면이 아무 반응도 하지 않았다.**
    // 여러 마리가 동시에 죽어도 누적되면 안 된다 — 반드시 덮어쓴다.
    bus.on(EV.ZOMBIE_DIED, () => {
      this._hitStop = Math.max(this._hitStop, DEATH.hitStop);
    });
    // 구역이 바뀌면 전투 흔적도 사라진다
    bus.on(EV.STAGE_LOADED, () => this.bloodDecals?.clear());

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(PLAYER.fov, 1, 0.1, 120);
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
    // 피격 시 튀는 피. 씬에 상주하며 이벤트로 터진다 (드로우콜 1)
    this.impact = new Impact(this.scene);
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
    // 전투 중에 바닥에 쌓이는 핏자국. 인스턴싱이라 드로우콜은 개수와 무관하게 1이다.
    // Scatter 가 이미 만들어 둔 데칼 재질·지오메트리를 그대로 빌려 쓴다 (새 에셋 0).
    const sc = this.stageLoader.scatter;
    this.bloodDecals = new BloodDecals(this.scene, sc.decalMat.splatter, sc.decalGeo);
    this.impact.decals = this.bloodDecals;

    bus.on(EV.SFX, () => {});   // AudioManager 가 구독 중 (파일 없으면 무시됨)
    bus.on(EV.PLAYER_DIED, () => this.onDeath());
    // 맞으면 화면 흔들림 말고 **화면 자체**도 반응한다 — 채도가 빠지고 초점이 나간다.
    // 지금까지는 HUD 의 빨간 테두리 하나뿐이라 "UI 가 알렸다"로만 읽혔다.
    bus.on(EV.PLAYER_DAMAGED, () => this.post?.hurt());

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
  /**
   * 셰이더를 미리 굽는다.
   *
   * three.js 는 재질이 **처음 화면에 들어오는 프레임**에 셰이더를 컴파일한다.
   * 그래서 시야를 확 돌려 새 물체가 들어오는 순간 그 프레임만 수십 ms 튄다 —
   * "확확 돌릴 때 렉 걸리듯 멈춘다"가 이 증상이다. 프레임 평균은 멀쩡한데
   * 체감만 나빠서 성능 문제로 오해하기 쉽다.
   *
   * 구역을 연 직후 한 번에 다 구워 두면 플레이 중에는 안 튄다.
   * **풀에 든 좀비는 숨어 있어서 traverseVisible 에 안 잡힌다** — 잠깐 보이게 해서
   * 같이 굽는다. 안 그러면 첫 좀비가 나타나는 순간 똑같이 튄다.
   */
  /**
   * @param warm 한 바퀴 돌며 미리 그릴 것인가 (`_warmupFrames`).
   *   **타이틀 화면에서는 끈다.** 타이틀은 같은 1구역을 느리게 훑는 연출이라
   *   거기서 구워지는 것이 어차피 플레이용과 같고, 시작을 누르면 `restart()` 가
   *   다시 굽는다 — 즉 켜 두면 **같은 일을 두 번** 하면서 그 시간이 통째로
   *   **로딩 막대 뒤에 붙는다**(실측 초기 로딩 4.8초 → 11.3초).
   *   타이틀에서 안 구우면 그 비용은 연출이 도는 동안 저절로 흩어진다.
   */
  _precompile(warm = true) {
    const hidden = [];
    for (const z of (this.pool?.all ?? [])) {
      if (z.group && !z.group.visible) { hidden.push(z.group); z.group.visible = true; }
    }
    try {
      this.renderer.compile(this.scene, this.camera);
      if (warm) this._warmupFrames();
    } catch { /* 실패해도 게임은 돌아간다 — 첫 프레임에 굽힐 뿐이다 */ }
    for (const g of hidden) g.visible = false;
  }

  /**
   * 카메라를 제자리에서 한 바퀴 돌리며 몇 프레임 그려 둔다.
   *
   * **`renderer.compile()` 만으로는 부족하다.** 그것은 화면에 그리는 재질만 굽고,
   * **그림자 패스가 쓰는 깊이 재질**(MeshDepthMaterial)은 그 물체가 손전등 원뿔에
   * **처음 들어오는 프레임**에 따로 컴파일된다. 그래서 구역을 열고 시야를 크게 돌리면
   * 그 각도에서 한 번씩 튀었다 — 사용자 보고 "화면 전환 크게 할 때마다 조금씩 끊긴다".
   *
   * 실측(구역 이동 직후 한 바퀴): 셰이더 프로그램 75 → 83, 그때마다 78~234ms.
   * 같은 자리를 두 번째로 돌면 조용하다 — **처음 보는 것에만 드는 비용**이라는 뜻이다.
   * 그래서 그 비용을 **로딩 중으로 옮긴다.** 총량은 같지만 플레이 중에는 안 보인다.
   *
   * 손전등을 강제로 켜는 이유: 꺼져 있으면 그림자 패스를 건너뛰므로
   * (`FLASHLIGHT.shadowWhenOff`) 깊이 재질이 하나도 안 구워진다.
   *
   * **반드시 `post.render` 로 굽는다 — `renderer.render` 로 구우면 헛수고가 섞인다.**
   * three 의 프로그램 캐시 키에는 **출력 색공간**이 들어간다. 캔버스에 바로 그리면
   * `srgb` 로, 후처리 렌더타깃에 그리면 `srgb-linear` 로 구워져 **서로 다른 프로그램**이
   * 된다. 실제로 캔버스로 구웠더니 그림자 깊이 재질(색공간과 무관)은 전부 잡혔는데
   * B1 의 유리 재질 하나만 계속 남아서, 그 구역에 들어가 150도를 볼 때 82~140ms 튀었다.
   */
  _warmupFrames() {
    const cam = this.camera;
    const fl = this.flashlight;
    const rot = cam.rotation.clone();
    const wasOn = fl?.on;
    const auto = this.renderer.shadowMap.autoUpdate;
    if (fl) fl.on = true;
    this.renderer.shadowMap.autoUpdate = true;
    cam.rotation.order = 'YXZ';

    // **아주 작게 그린다.** 컴파일되는 프로그램은 해상도와 무관한데, 풀 해상도로 36프레임을
    // 그리면(게다가 4096² 그림자 패스까지) 구역 전환이 통째로 멈춘다 — 실측으로
    // 로딩이 7초에서 44초가 됐고 검사 회차가 타임아웃으로 죽었다.
    // 픽셀만 줄이고 **훑는 각도와 렌더 경로는 그대로 둔다.**
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    const dpr = this.renderer.getPixelRatio();
    const shadow = fl?.light?.shadow;
    const shadowWas = shadow ? shadow.mapSize.x : 0;
    this.renderer.setPixelRatio(PERF.warmupPixelRatio);
    this.post?.setSize(size.x, size.y);
    if (shadow) {
      // mapSize 를 바꾸면 기존 뎁스 텍스처를 버려야 새 크기로 다시 잡힌다
      shadow.mapSize.setScalar(PERF.warmupShadowSize);
      shadow.map?.dispose(); shadow.map = null;
    }
    const n = PERF.warmupSteps;
    // **피치마다 한 바퀴씩 돈다.** 한 바퀴를 돌면서 피치를 같이 돌리면 각도와 피치가
    // 짝지어져 버려서, "그 각도를 다른 피치로만 본" 조합이 남는다 — 실제로 그렇게 해서
    // 컴파일이 8회에서 1회로 줄고 마지막 하나가 남았다(150도, 94ms).
    // 천장·바닥은 벽과 재질이 다르므로 위아래도 각각 훑어야 한다.
    for (const pitch of [0, -PERF.warmupPitch, PERF.warmupPitch]) {
      for (let i = 0; i < n; i++) {
        cam.rotation.y = rot.y + (i / n) * Math.PI * 2;
        cam.rotation.x = pitch;
        cam.updateMatrixWorld(true);
        fl?.update(PERF.warmupDt);
        this.renderer.shadowMap.needsUpdate = true;
        // 게임과 같은 경로로 그린다 (위 주석 참고). 후처리가 아직 없으면 그냥 렌더한다.
        if (this.post) this.post.render(PERF.warmupDt);
        else this.renderer.render(this.scene, cam);
      }
    }
    cam.rotation.copy(rot);
    cam.updateMatrixWorld(true);
    // 원래 크기로 되돌린다. 그림자 맵도 다시 버려야 4096² 로 새로 잡힌다
    if (shadow) {
      shadow.mapSize.setScalar(shadowWas);
      shadow.map?.dispose(); shadow.map = null;
    }
    this.renderer.setPixelRatio(dpr);
    this.post?.setSize(size.x, size.y);
    this.renderer.shadowMap.autoUpdate = auto;
    if (fl) fl.on = wasOn;
  }

  startAttract() {
    this.stageLoader.load(STAGES[0]);
    this._precompile(false);   // 타이틀에서는 굽지 않는다 (위 주석)
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
    this.atmosphere.update(dt, cam);   // 비상등 슬롯 배정이 구도를 봐야 한다
  }

  async start() {
    await this.audio.init();
    // 소품 GLB 는 스테이지를 짓기 전에 다 읽혀 있어야 한다 (조립이 동기라서).
    // 실패해도 절차적 소품으로 되돌아가므로 게임은 진행된다.
    await propModels.preload();
    // 스윙 궤적 — 없으면 절차적 스윙으로 떨어지므로 실패해도 게임은 그대로 돌아간다
    await preloadSwingCurves();
    // 시작 무기는 Game 생성 시점(모델 로드 전)에 만들어졌다 — 여기서 GLB 로 다시 만든다
    this.weapons.refreshViewModel();
    this.audio.playAmbience();
    this.restart();
  }

  /**
   * @param fromCheckpoint true 면 마지막으로 도달한 구역부터. 사망 화면의 "이 구역부터" 다.
   */
  restart(fromCheckpoint = false) {
    const cp = (fromCheckpoint && CHECKPOINT.enabled && this._checkpoint) ? this._checkpoint : null;
    this.stageIndex = cp ? cp.index : 0;
    this.weapons.viewRoot.visible = true;   // 시작 화면에서 숨겨 놓았다
    this.pool.despawnAll();
    const stage = STAGES[this.stageIndex];
    const start = this.stageLoader.load(stage);
    this.player.surfaceAt = this.stageLoader.surfaceAt;
    this.player.spawn(start.x, start.z, start.yaw);
    this._precompile();

    if (cp) {
      // 그 구역에 들어섰던 상태로 되돌린다. 다만 빈사로 들어왔다면 죽음의 고리에 갇히므로
      // 최소선까지는 올려 준다 (CHECKPOINT.min*)
      this.player.hp = Math.max(cp.hp, CHECKPOINT.minHp);
      this.flashlight.battery = Math.max(cp.battery, CHECKPOINT.minBattery);
      this.weapons.restoreState(cp.weapons, CHECKPOINT.minAmmo);
      this.elapsed = cp.elapsed;
    } else {
      this.flashlight.battery = 100;
      this.elapsed = 0;
      this._checkpoint = null;
    }
    this.flashlight.on = false;
    this.state = 'PLAYING';
    this.input.enabled = true;
    this.input.requestLock();
    this.hud.show();
    this.weapons._emitAmmo();
    this._saveCheckpoint();
    bus.emit(EV.OBJECTIVE, { text: stage.meta?.objective ?? stage.meta?.label ?? '' });
    bus.emit(EV.HINT, {
      text: cp ? `${stage.meta?.label ?? ''} — 다시 시작` : 'F 를 눌러 손전등을 켜라',
      duration: 4,
    });
  }

  /** 구역에 들어선 순간의 상태를 적어 둔다. 여기서 다시 시작하게 된다 */
  _saveCheckpoint() {
    this._checkpoint = {
      index: this.stageIndex,
      hp: this.player.hp,
      battery: this.flashlight.battery,
      weapons: this.weapons.snapshotState(),
      elapsed: this.elapsed,
    };
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
    this._precompile();
    this.player.hp = hp;
    this.flashlight.battery = battery;
    this._saveCheckpoint();
    bus.emit(EV.OBJECTIVE, { text: stage.meta?.objective ?? stage.meta?.label ?? '' });
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
    // 1구역에서 죽었으면 "이 구역부터"와 "처음부터"가 같은 말이다 — 하나만 남긴다
    const atStart = !CHECKPOINT.enabled || (this._checkpoint?.index ?? 0) === 0;
    const retry = document.getElementById('btn-retry');
    const full = document.getElementById('btn-restart');
    if (retry) retry.textContent = atStart ? '다시 시도' : '이 구역부터';
    if (full) full.style.display = atStart ? 'none' : '';
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

  /**
   * 적응형 해상도 — 프레임이 예산을 넘으면 렌더 배율을 낮추고, 여유가 생기면 되돌린다.
   * 관찰 창(adaptWindow) 없이 매 프레임 판단하면 해상도가 출렁여서 더 거슬린다.
   */
  _adaptResolution(dt) {
    if (!PERF.adaptive) return;
    this._adaptT += dt;
    // 스톨(셰이더 컴파일·GC)은 평균에서 뺀다 — 렌더가 무거워서 늦은 프레임이 아니다
    const ms = dt * 1000;
    if (ms <= PERF.stallMs) { this._frameAcc += ms; this._frameN++; }
    if (this._adaptT < PERF.adaptWindow) return;

    // 창 전체가 스톨이었으면 판단할 근거가 없다. 다음 창을 기다린다
    if (this._frameN < 5) { this._frameAcc = 0; this._frameN = 0; this._adaptT = 0; return; }

    const avg = this._frameAcc / this._frameN;
    this._frameAcc = 0; this._frameN = 0; this._adaptT = 0;

    // 상한(PERF.fpsCap)이 걸려 있으면 프레임 간격은 상한에 딱 붙어 있게 된다.
    // 그 값을 예산과 그대로 비교하면 "항상 초과"로 읽혀 해상도가 바닥까지 내려간다.
    // 그래서 상한이 있을 때는 **상한을 못 지킬 때만** 낮추고, 되돌리지는 않는다 —
    // 되돌리면 낮췄다 올렸다를 반복하며 버퍼를 다시 잡느라 그때마다 한 번씩 끊긴다.
    const capMs = PERF.fpsCap ? 1000 / PERF.fpsCap : 0;
    const budget = capMs ? capMs * 1.25 : PERF.frameBudgetMs;
    const good = capMs ? -1 : PERF.frameGoodMs;

    // 천장은 devicePixelRatio 로 자르지 않는다 — 넘겨서 그린 뒤 줄이는 것(수퍼샘플링)이
    // 계단을 없애는 가장 좋은 방법이고, 그 여유가 있는 PC 에서는 그렇게 쓰는 편이 낫다.
    let next = this._dprCap;
    if (avg > budget) {
      // 많이 초과했으면 성큼, 조금이면 한 칸만 — 한 번에 크게 내리면 멀쩡한 배율을 지나친다
      const step = avg > budget * PERF.adaptBadRatio ? PERF.adaptStep : PERF.adaptStepFine;
      // 이 배율은 못 버텼다. 기억해 두고 다시는 여기까지 안 올라간다 → 오르내림이 멈춘다
      this._dprFailed = Math.min(this._dprFailed ?? Infinity, this._dprCap);
      next = Math.max(PERF.pixelRatioMin, next - step);
      this._goodStreak = 0;
    } else if (avg < good) {
      // 올릴 때는 연속으로 여유가 확인될 때만, 그리고 한 칸씩
      this._goodStreak = (this._goodStreak ?? 0) + 1;
      if (this._goodStreak >= PERF.adaptUpAfter) {
        // 못 버틴 배율 바로 아래까지만 올라간다
        const ceiling = Math.min(PERF.pixelRatioMax,
          (this._dprFailed ?? Infinity) - PERF.adaptStepUp);
        next = Math.min(ceiling, next + PERF.adaptStepUp);
        this._goodStreak = 0;
      }
    } else {
      this._goodStreak = 0;
    }

    if (Math.abs(next - this._dprCap) > 0.01) {
      this._dprCap = next;
      this.renderer.setPixelRatio(next);
      // 후처리 버퍼도 같이 다시 잡아야 한다 — 안 하면 합성 결과가 늘어나 뿌옇게 보인다
      this.resize();
    }
  }

  _loop() {
    requestAnimationFrame(this._loop);

    // 프레임 상한 (PERF.fpsCap). 분위기를 위한 값이라 0 이면 주사율대로 간다.
    // 여유(0.9배)를 두는 이유: 정확히 재면 vsync 를 한 번 놓쳐서 60 을 걸었는데
    // 30 으로 떨어지는 일이 생긴다.
    if (PERF.fpsCap) {
      const now = performance.now();
      if (now - (this._lastFrameAt ?? 0) < (1000 / PERF.fpsCap) * 0.9) return;
      this._lastFrameAt = now;
    }

    let dt = Math.min(0.05, this.clock.getDelta());   // 프레임 급락 시 물리 폭주 방지
    this._adaptResolution(dt);

    // 히트스톱 — 근접이 몸에 닿는 순간 세상이 잠깐 걸린다. 근접 타격감의 절반이 이것이다.
    //
    // **완전 정지(dt=0)가 아니라 초저속이다.** 완전히 멈추면 "묵직하게 걸렸다"가
    // 아니라 "한 프레임 씹혔다"로 읽힌다. 좀비 애니메이션과 핏방울이 아주 느리게
    // 흐르고 화면흔들림도 살아 있어야 부딪힌 것이 눈에 보인다.
    // SHAKE.hitStopScale 을 0 으로 두면 예전 동작(완전 정지)으로 돌아간다.
    if (this._hitStop > 0) { this._hitStop -= dt; dt *= SHAKE.hitStopScale; }

    if (this.state === 'PLAYING') {
      this.elapsed += dt;
      this.player.update(dt);
      if (this.input.justPressed('KeyF')) this.flashlight.toggle();
      this.flashlight.update(dt);
      this.weapons.update(dt, this.input);

      const pc = this._poolCtx;
      pc.player = this.player;
      pc.collision = this.collision;
      pc.detectionMul = this.flashlight.detectionMultiplier;
      // 좀비 발소리도 밟는 바닥을 따른다 (player 에 넘기는 것과 같은 함수다)
      pc.surfaceAt = this.stageLoader.surfaceAt;
      this.pool.update(dt, pc);
      this.director.update(dt);
      // 카메라를 넘긴다 — 비상등이 고정 슬롯이라, 지금 화면에 영향을 주는 것들만
      // 슬롯에 실어야 한다 (fx/Atmosphere.js `_assignSlots`)
      this.atmosphere.update(dt, this.camera);
      this.impact.update(dt);

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
        this.interaction.use(target, { player: this.player, flashlight: this.flashlight, weapons: this.weapons });
      }

      // 물려 있으면 뿌리치기 게이지와 남은 시간을 띄운다 (-1 = 안 물림)
      this.hud.setStruggle(
        this.player.grabbedBy ? this.player.struggle : -1, this.player.grabLeft ?? 1);

      this.audio.setListener(this.player.pos.x, this.player.pos.z, this.player.yaw);
      const hc = this._hudCtx;
      hc.player = this.player; hc.flashlight = this.flashlight;
      // 노출도 표시가 "누가 나를 눈치챘나"를 봐야 한다. **풀을 통째로 넘긴다** —
      // HUD 는 어차피 비활성 개체를 건너뛰므로, getActive() 로 매 프레임
      // 배열을 새로 뜨는 것은 순수한 낭비였다.
      hc.zombies = this.pool.all;
      this.hud.update(dt, hc);
      if (this.input.justPressed('Backquote')) this.hud.toggleDebug();
      const dc = this._dbgCtx;
      dc.input = this.input; dc.player = this.player; dc.dt = dt;
      // 풀을 넘긴다 — activeCount 는 전체 순회라, 숨어 있는 디버그 패널을 위해
      // 매 프레임 세고 나서 버리고 있었다. HUD 가 패널이 켜졌을 때만 센다.
      dc.renderer = this.renderer; dc.pool = this.pool;
      this.hud.updateDebug(dc);

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
