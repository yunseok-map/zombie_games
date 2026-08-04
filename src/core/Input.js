/**
 * Input — 키보드 / 마우스 / 포인터락.
 * 프레임마다 update() 에서 consume 되는 값(마우스 델타, 눌린 순간)을 구분해 제공한다.
 */
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
    };
    this._onKeyUp = (e) => { this.keys.delete(e.code); };

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

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
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
  requestLock(retry = 2) {
    const el = this.canvas;
    if (!el.requestPointerLock) return;
    let p;
    try {
      p = el.requestPointerLock({ unadjustedMovement: true });
    } catch {
      try { el.requestPointerLock(); } catch { /* 무시 */ }
      return;
    }
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        if (retry > 0) setTimeout(() => this.requestLock(retry - 1), 350);
        else { try { el.requestPointerLock(); } catch { /* 무시 */ } }
      });
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
