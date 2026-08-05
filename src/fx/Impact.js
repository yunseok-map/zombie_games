import * as THREE from 'three';
import { IMPACT } from '../config/balance.js';
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

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('psize', new THREE.BufferAttribute(this.size, 1));

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(IMPACT.color) },
        uScale: { value: IMPACT.pixelScale },
      },
      vertexShader: /* glsl */`
        attribute float psize;
        varying float vS;
        uniform float uScale;
        void main() {
          vS = psize;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (psize * uScale) / max(-mv.z, 0.3);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor;
        varying float vS;
        void main() {
          if (vS <= 0.0) discard;
          vec2 d = gl_PointCoord - 0.5;
          float r = 1.0 - smoothstep(0.2, 0.5, length(d));
          if (r <= 0.01) discard;
          gl_FragColor = vec4(uColor, r);
        }`,
      transparent: true,
      depthWrite: false,
    });

    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    scene.add(this.points);

    bus.on(EV.ZOMBIE_HIT, (e) => this.burst(e));
  }

  /** @param e {x,y,z,nx,nz,power} — nx/nz 는 튀어나갈 방향(때린 쪽 반대) */
  burst({ x, y, z, nx = 0, nz = 1, power = 1 }) {
    const n = Math.round(IMPACT.perHit * Math.min(2, power));
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % IMPACT.count;
      const s = IMPACT.spread;
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
      // 맞은 방향으로 흩어지되 위로도 조금 — 옆으로만 튀면 물총처럼 보인다
      this.vel[i * 3] = nx * IMPACT.speed + (Math.random() - 0.5) * s;
      this.vel[i * 3 + 1] = Math.random() * IMPACT.up;
      this.vel[i * 3 + 2] = nz * IMPACT.speed + (Math.random() - 0.5) * s;
      this.life[i] = IMPACT.life * (0.6 + Math.random() * 0.7);
      this.size[i] = IMPACT.sizeMin + Math.random() * (IMPACT.sizeMax - IMPACT.sizeMin);
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
      this.vel[i * 3 + 1] -= IMPACT.gravity * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02) {  // 바닥에 닿으면 멈춘다
        this.pos[i * 3 + 1] = 0.02;
        this.vel[i * 3] = this.vel[i * 3 + 1] = this.vel[i * 3 + 2] = 0;
      }
    }
    if (alive) {
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.psize.needsUpdate = true;
    }
    this.points.visible = alive > 0;
  }
}
