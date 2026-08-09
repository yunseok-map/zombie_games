/**
 * Input — 키보드 / 마우스 / 포인터락.
 * 프레임마다 update() 에서 consume 되는 값(마우스 델타, 눌린 순간)을 구분해 제공한다.
 */
/**
 * Alt 와 함께 눌렸을 때 브라우저 기본 동작을 막을 키. Game._devKeys 가 쓰는 조합이다.
 *
 * **Ctrl 을 쓰면 안 된다** — Ctrl 은 웅크리기다(Player.update). 조합을 누를 때마다
 * 플레이어가 같이 앉아 버려서 화면이 내려간다. 그래서 Alt 로 옮겼다.
 * **Alt+N·T·W 류를 넣어도 소용없다** — 크롬이 예약해서 페이지로 오지도 않는다.
 */
const DEV_COMBOS = ['KeyG', 'KeyM', 'KeyI'];

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();     // 이번 프레임에 새로 눌린 키
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mouseLeft = false;
    this.mouseRight = false;
    this.mouseLeftPressed = false;
    this.locked = false;
    this.enabled = false;

    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      const c = e.code;
      if (!this.keys.has(c)) this.pressed.add(c);
      this.keys.add(c);
      if (['Space', 'Tab', 'KeyE', 'KeyR', 'KeyF'].includes(c)) e.preventDefault();
      // 관리자 조합(Game._devKeys) 이 브라우저 기능을 같이 여는 것을 막는다.
      // Alt 단독 keyup 은 크롬 메뉴 표시줄에 포커스를 던지므로 Alt 계열은 전부 막는다.
      if (e.altKey && DEV_COMBOS.includes(c)) e.preventDefault();
    };
    this._onKeyUp = (e) => { this.keys.delete(e.code); };
    // 창이 포커스를 잃으면 keyup 이 안 온다 → 키가 눌린 채로 굳는다
    this._onBlur = () => { this.keys.clear(); this.mouseLeft = this.mouseRight = false; };

    this._onMouseMove = (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    };
    this._onMouseDown = (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.mouseLeft = true; this.mouseLeftPressed = true; }
      if (e.button === 2) this.mouseRight = true;
    };
    this._onMouseUp = (e) => {
      if (e.button === 0) this.mouseLeft = false;
      if (e.button === 2) this.mouseRight = false;
    };
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.keys.clear(); this.mouseLeft = this.mouseRight = false; }
      this.onLockChange?.(this.locked);
    };
    this._onContext = (e) => e.preventDefault();
    // 포인터락이 조용히 실패했을 때의 탈출구 — 화면을 클릭하면 다시 건다
    this._onCanvasClick = () => { if (this.enabled && !this.locked) this.requestLock(); };

    // capture 단계로 받는다 — 한글 IME 나 다른 핸들러가 먼저 삼키는 경우를 피한다
    window.addEventListener('keydown', this._onKeyDown, true);
    window.addEventListener('keyup', this._onKeyUp, true);
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mousedown', this._onMouseDown);
    document.addEventListener('mouseup', this._onMouseUp);
    document.addEventListener('pointerlockchange', this._onLockChange);
    canvas.addEventListener('contextmenu', this._onContext);
    canvas.addEventListener('click', this._onCanvasClick);
  }

  /**
   * 포인터락 요청.
   * - `unadjustedMovement`: OS 마우스 가속/스무딩을 끈 원시 입력. 조준이 훨씬 정확해진다.
   * - Esc 직후 재요청은 브라우저가 잠깐(약 1초) 거부한다. 실패하면 조용히 재시도한다.
   */
  requestLock() {
    const el = this.canvas;
    if (!el.requestPointerLock) return;
    // **인자 없는 requestPointerLock 도 Promise 를 돌려준다.** try/catch 는 그 거부를
    // 못 잡아서, 브라우저가 락을 거절할 때마다(락을 푼 직후 다시 걸면 크롬이 잠깐 막는다)
    // `NotAllowedError` 가 처리되지 않은 거부로 콘솔에 남았다.
    // 이 프로젝트는 콘솔이 깨끗한 것을 QA 기준으로 쓰므로, 소음이 진짜 에러를 가린다.
    const plain = () => {
      try {
        const q = el.requestPointerLock();
        if (q && typeof q.catch === 'function') q.catch(() => { /* 사용자가 다시 클릭하면 걸린다 */ });
      } catch { /* 무시 */ }
    };
    try {
      const p = el.requestPointerLock({ unadjustedMovement: true });
      // 지원 안 하는 환경이면 거부된다. 곧바로 기본 방식으로 다시 건다.
      // 절대 setTimeout 으로 미루면 안 된다 — 포인터락은 사용자 제스처 안에서만 허용된다.
      if (p && typeof p.catch === 'function') p.catch(plain);
    } catch {
      plain();
    }
  }
  releaseLock() { document.exitPointerLock?.(); }

  down(code) { return this.keys.has(code); }
  justPressed(code) { return this.pressed.has(code); }

  /** 프레임 끝에서 호출 — 1프레임짜리 상태를 비운다 */
  endFrame() {
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mouseLeftPressed = false;
  }
}
