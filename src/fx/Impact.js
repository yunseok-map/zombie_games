import * as THREE from 'three';
import { IMPACT, WALL_IMPACT } from '../config/balance.js';
import { bus, EV } from '../core/EventBus.js';

/**
 * Impact — 피격 순간 튀는 피.
 *
 * 소리와 애니메이션만으로는 "닿았다"가 약하다. 맞은 자리에서 뭔가 튀어야
 * 타격이 몸에 닿았다고 읽힌다.
 *
 * 입자를 미리 다 만들어 두고 돌려쓴다 — 드로우콜 1개, 런타임 할당 0.
 * 죽은 입자는 화면 밖(아래)으로 보내 버린다. 지오메트리를 다시 만들지 않는다.
 *
 * 가산 합성이 아니라 보통 합성이다. 피는 빛나는 게 아니라 어두워야 한다.
 */
export class Impact {
  constructor(scene) {
    const N = IMPACT.count;
    this.pos = new Float32Array(N * 3);
    this.vel = new Float32Array(N * 3);
    this.life = new Float32Array(N);
    this.size = new Float32Array(N);
    this.next = 0;

    for (let i = 0; i < N; i++) this.pos[i * 3 + 1] = -999;   // 처음엔 안 보이게 치워 둔다

    // 입자마다 색을 섞는 비율. 0 = 기본 피, 1 = 헤드샷의 밝은 피, 2 = 벽 먼지.
    // 하나의 링버퍼로 세 가지를 다 돌리려면 색이 uniform 이면 안 된다.
    this.mix = new Float32Array(N);
    // 이미 바닥에 눕은 입자. 이게 없으면 착지 판정이 매 프레임 다시 참이 된다(update 참고)
    this.landed = new Uint8Array(N);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('psize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('pmix', new THREE.BufferAttribute(this.mix, 1));

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(IMPACT.color) },
        uColorHot: { value: new THREE.Color(IMPACT.colorHot) },
        uColorDust: { value: new THREE.Color(WALL_IMPACT.dustColor) },
        uScale: { value: IMPACT.pixelScale },
        uCore: { value: IMPACT.coreRadius },
      },
      vertexShader: /* glsl */`
        attribute float psize;
        attribute float pmix;
        varying float vS;
        varying float vM;
        uniform float uScale;
        void main() {
          vS = psize;
          vM = pmix;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (psize * uScale) / max(-mv.z, 0.3);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor;
        uniform vec3 uColorHot;
        uniform vec3 uColorDust;
        uniform float uCore;
        varying float vS;
        varying float vM;
        void main() {
          if (vS <= 0.0) discard;
          vec2 d = gl_PointCoord - 0.5;
          float r = 1.0 - smoothstep(uCore, 0.5, length(d));
          if (r <= 0.01) discard;
          // 0~1 은 피(어두운 → 밝은), 1~2 는 먼지로 넘어간다
          vec3 blood = mix(uColor, uColorHot, clamp(vM, 0.0, 1.0));
          vec3 c = mix(blood, uColorDust, clamp(vM - 1.0, 0.0, 1.0));
          gl_FragColor = vec4(c, r);
        }`,
      transparent: true,
      depthWrite: false,
    });

    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    scene.add(this.points);

    bus.on(EV.ZOMBIE_HIT, (e) => this.burst(e));
    bus.on(EV.WALL_HIT, (e) => this.dust(e));
  }

  /**
   * @param e {x,y,z,nx,nz,power,headshot,hot} — nx/nz 는 튀어나갈 방향(때린 쪽 반대)
   *
   * `headshot` 은 **의미** 플래그다 — 화면흔들림(Player)과 히트마커(HUD)도 같이 읽는다.
   * `hot` 은 **생김새**만 바꾼다(크고 밝고 높이). 기본값은 headshot 이라 평소엔 같지만,
   * 사망 버스트처럼 "머리를 맞힌 건 아닌데 크게 터뜨리고 싶은" 경우에 hot 만 켠다.
   */
  burst({ x, y, z, nx = 0, nz = 1, power = 1, headshot = false, hot = headshot }) {
    const n = Math.round(IMPACT.perHit * Math.min(2, power));
    // 머리는 더 크고 밝고 높이 튄다. 예전에는 헤드샷의 시각적 보상이
    // "입자가 조금 더 많다"뿐이었다 — 데미지가 2.2배인데 화면이 그걸 안 말했다.
    const sizeMul = hot ? IMPACT.headSizeMul : 1;
    const upMul = hot ? IMPACT.headUpMul : 1;
    const s = IMPACT.spread * (hot ? IMPACT.headSpreadMul : 1);
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % IMPACT.count;
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
      // 맞은 방향으로 흩어지되 위로도 조금 — 옆으로만 튀면 물총처럼 보인다
      this.vel[i * 3] = nx * IMPACT.speed + (Math.random() - 0.5) * s;
      this.vel[i * 3 + 1] = Math.random() * IMPACT.up * upMul;
      this.vel[i * 3 + 2] = nz * IMPACT.speed + (Math.random() - 0.5) * s;
      this.life[i] = IMPACT.life * (0.6 + Math.random() * 0.7);
      this.size[i] = (IMPACT.sizeMin + Math.random() * (IMPACT.sizeMax - IMPACT.sizeMin)) * sizeMul;
      this.mix[i] = hot ? 0.5 + Math.random() * 0.5 : 0;
      this.landed[i] = 0;    // 링버퍼라 누워 있던 슬롯을 물려받는다. 안 지우면 안 움직인다
    }
  }

  /**
   * 벽·바닥에 총알이 박혔을 때의 먼지. 같은 링버퍼를 쓰되 색만 회색 쪽으로 간다.
   * 지금까지 빗맞히면 총구 화염 말고는 화면에 아무 일도 안 일어났다 —
   * 칠흑 속에서 조준이 맞았는지 틀렸는지 알 단서가 없었다.
   * @param e {x,y,z,nx,ny,nz} — n 은 표면 법선(튀어나올 방향)
   */
  dust({ x, y, z, nx = 0, ny = 0, nz = 1 }) {
    for (let k = 0; k < WALL_IMPACT.dustCount; k++) {
      const i = this.next;
      this.next = (this.next + 1) % IMPACT.count;
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
      const side = WALL_IMPACT.dustSide;
      this.vel[i * 3] = nx * WALL_IMPACT.dustSpeed + (Math.random() - 0.5) * side;
      this.vel[i * 3 + 1] = ny * WALL_IMPACT.dustSpeed + Math.random() * WALL_IMPACT.dustUp;
      this.vel[i * 3 + 2] = nz * WALL_IMPACT.dustSpeed + (Math.random() - 0.5) * side;
      this.life[i] = WALL_IMPACT.dustLife * (0.6 + Math.random() * 0.7);
      this.size[i] = WALL_IMPACT.dustSizeMin
        + Math.random() * (WALL_IMPACT.dustSizeMax - WALL_IMPACT.dustSizeMin);
      this.mix[i] = 2;                     // 먼지 색
      this.landed[i] = 0;
    }
  }

  update(dt) {
    let alive = 0;
    for (let i = 0; i < IMPACT.count; i++) {
      if (this.life[i] <= 0) continue;
      alive++;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.size[i] = 0;
        this.pos[i * 3 + 1] = -999;      // 화면 밖으로 치운다
        continue;
      }
      // **이미 누운 입자는 더 적분하지 않는다.** 아래 중력은 착지 여부와 상관없이
      // 먼저 들어가므로, 멈춘 입자도 다음 프레임이면 vel.y 가 0 이 아니게 되고
      // 위치도 바닥 밑으로 다시 내려간다 — 그래서 "닿는 첫 프레임" 판정이
      // 입자가 사라질 때까지 매 프레임 다시 참이 됐다. 속도로 착지를 판별하려던
      // 예전 가드(`vel.y !== 0`)가 통째로 무력했고, 핏자국이 의도의 **5~7배**로
      // 찍혔다(측정: 몸통 피격 1.2 → 7.4개, 사망 버스트 1.9 → 12.8개).
      // 그 결과 64칸 링버퍼가 좀비 한두 마리 만에 한 바퀴 돌아, 방금 찍힌 자국이
      // 사라지고 `decalFade` 12초는 재생될 기회조차 없었다.
      if (this.landed[i]) continue;
      this.vel[i * 3 + 1] -= IMPACT.gravity * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const restY = IMPACT.decalY + IMPACT.decalLandY;
      if (this.pos[i * 3 + 1] < restY) {          // 바닥에 닿으면 멈춘다
        // 자국은 **닿는 이 프레임에 한 번만** — landed 를 세우므로 다시 오지 않는다
        if (this.decals && this.mix[i] < 1.5 && Math.random() < IMPACT.decalChance) {
          this.decals.stamp(this.pos[i * 3], this.pos[i * 3 + 2]);
        }
        this.pos[i * 3 + 1] = restY;
        this.vel[i * 3] = this.vel[i * 3 + 1] = this.vel[i * 3 + 2] = 0;
        this.landed[i] = 1;
      }
    }
    if (alive) {
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.psize.needsUpdate = true;
      this.points.geometry.attributes.pmix.needsUpdate = true;
    }
    this.points.visible = alive > 0;
    this.decals?.update(dt);
  }
}
