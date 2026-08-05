import * as THREE from 'three';
import { FLASHLIGHT } from '../config/balance.js';
import { bus, EV } from '../core/EventBus.js';

/**
 * Flashlight — 이 게임의 실질적 주인공.
 * 켜면 보이지만 좀비 감지 반경이 늘어난다 (SPEC.md §4).
 * 씬에서 유일하게 그림자를 드리우는 광원이다 (CLAUDE.md §3).
 */
export class Flashlight {
  constructor(camera, scene) {
    this.camera = camera;
    this.on = false;
    this.battery = FLASHLIGHT.maxBattery;
    this._flicker = 1;
    this._flickerTimer = 0;

    this.light = new THREE.SpotLight(
      FLASHLIGHT.color,
      0,
      FLASHLIGHT.range,
      THREE.MathUtils.degToRad(FLASHLIGHT.angleDeg),
      FLASHLIGHT.penumbra,
      1.1
    );
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(FLASHLIGHT.shadowMapSize, FLASHLIGHT.shadowMapSize);
    this.light.shadow.camera.near = 0.3;
    this.light.shadow.camera.far = FLASHLIGHT.range;
    this.light.shadow.bias = -0.0016;

    this.target = new THREE.Object3D();
    this.light.target = this.target;

    scene.add(this.light);
    scene.add(this.target);
    this._buildVolume(scene);
  }

  /**
   * 빛줄기 속에 떠다니는 먼지.
   *
   * 원뿔 메시로 빛기둥을 그리는 방법은 **안에서 보면 원뿔 벽면이 통째로 빛나서**
   * 즉시 가짜로 보인다(시선이 벽면과 나란해질수록 밝아진다). 그래서 대신
   * 입자를 뿌리고, 손전등 원뿔 안에 들어온 것만 밝게 그린다.
   * 공기가 보인다는 인상은 같은데 인공물이 안 생기고 훨씬 싸다.
   *
   * 입자는 카메라를 중심으로 한 정육면체 안에서 **감싸며 반복**된다(shader 의 mod).
   * 그래서 어디로 가도 항상 주위에 있지만, 카메라에 붙어 따라오지는 않는다.
   */
  _buildVolume(scene) {
    const N = FLASHLIGHT.dustCount;
    const S = FLASHLIGHT.dustField;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = Math.random() * S;
      pos[i * 3 + 1] = Math.random() * S;
      pos[i * 3 + 2] = Math.random() * S;
      seed[i] = Math.random() * 6.283;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));

    this.volumeMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(FLASHLIGHT.color) },
        uIntensity: { value: 0 },
        uTime: { value: 0 },
        uCam: { value: new THREE.Vector3() },
        uOrigin: { value: new THREE.Vector3() },
        uDir: { value: new THREE.Vector3(0, 0, -1) },
        uCos: { value: Math.cos(THREE.MathUtils.degToRad(FLASHLIGHT.angleDeg)) },
        uRange: { value: FLASHLIGHT.range },
        uField: { value: S },
        uSize: { value: FLASHLIGHT.dustSize },
      },
      vertexShader: /* glsl */`
        attribute float seed;
        uniform vec3 uCam; uniform vec3 uOrigin; uniform vec3 uDir;
        uniform float uCos; uniform float uRange; uniform float uField;
        uniform float uTime; uniform float uSize;
        varying float vA;
        void main() {
          // 카메라를 중심으로 감싸며 반복 — 어디로 가도 주위에 먼지가 있다
          vec3 drift = vec3(sin(uTime * 0.3 + seed), sin(uTime * 0.21 + seed * 1.7) * 0.6,
                            cos(uTime * 0.26 + seed)) * 0.35;
          vec3 p = mod(position + drift - uCam + uField * 0.5, uField) + uCam - uField * 0.5;

          vec3 toP = p - uOrigin;
          float dist = length(toP);
          float c = dot(normalize(toP), uDir);
          // 원뿔 안쪽만, 가장자리는 부드럽게. 멀수록 옅게.
          float cone = smoothstep(uCos, mix(uCos, 1.0, 0.45), c);
          float fall = 1.0 - smoothstep(uRange * 0.15, uRange, dist);
          vA = cone * fall;

          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uSize / max(-mv.z, 0.4);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; uniform float uIntensity;
        varying float vA;
        void main() {
          if (vA <= 0.001) discard;
          vec2 d = gl_PointCoord - 0.5;
          float r = 1.0 - smoothstep(0.15, 0.5, length(d));   // 동그란 알갱이
          gl_FragColor = vec4(uColor, vA * r * uIntensity);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.volume = new THREE.Points(geo, this.volumeMat);
    this.volume.frustumCulled = false;   // 항상 카메라 주위라 컬링 계산이 무의미하다
    this.volume.renderOrder = 3;
    this.volume.visible = false;
    scene.add(this.volume);
  }

  toggle() {
    if (this.battery <= 0) return;
    this.on = !this.on;
    bus.emit(EV.SFX, { name: 'flashlight', volume: 0.6 });
    bus.emit(EV.FLASHLIGHT_TOGGLED, { on: this.on });
  }

  update(dt) {
    if (this.on) {
      this.battery = Math.max(0, this.battery - FLASHLIGHT.drain * dt);
      if (this.battery <= 0) {
        this.on = false;
        bus.emit(EV.FLASHLIGHT_TOGGLED, { on: false });
      }
    }

    // 배터리 부족하면 깜빡임 — 공포 연출이자 경고
    if (this.on && this.battery < FLASHLIGHT.flickerBelow) {
      this._flickerTimer -= dt;
      if (this._flickerTimer <= 0) {
        this._flickerTimer = 0.04 + Math.random() * 0.22;
        this._flicker = Math.random() < 0.3 ? (0.05 + Math.random() * 0.3) : 1;
      }
    } else {
      this._flicker = 1;
    }

    this.light.intensity = this.on ? FLASHLIGHT.intensity * this._flicker : 0;

    // 카메라에 붙인다 (약간 아래·오른쪽 — 손에 든 느낌)
    const cam = this.camera;
    this.light.position.copy(cam.position);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    this.light.position.addScaledVector(right, 0.22).y -= 0.14;
    this.target.position.copy(this.light.position).addScaledVector(dir, 10);

    // 빛기둥은 광원과 같은 자리·같은 방향
    const vol = this.volume;
    vol.visible = this.on && FLASHLIGHT.volumeIntensity > 0;
    if (vol.visible) {
      const u = this.volumeMat.uniforms;
      u.uCam.value.copy(cam.position);
      u.uOrigin.value.copy(this.light.position);
      u.uDir.value.copy(dir);
      u.uIntensity.value = FLASHLIGHT.volumeIntensity * this._flicker;
      u.uTime.value += dt * FLASHLIGHT.volumeDustSpeed;
    }
  }

  addBattery(amount) {
    this.battery = Math.min(FLASHLIGHT.maxBattery, this.battery + amount);
  }

  /** 좀비 감지 반경 배수 */
  get detectionMultiplier() {
    return this.on ? FLASHLIGHT.detectionMultiplier : 1;
  }
}
