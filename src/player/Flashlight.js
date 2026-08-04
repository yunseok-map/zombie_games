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
    this.light.shadow.mapSize.set(1024, 1024);
    this.light.shadow.camera.near = 0.3;
    this.light.shadow.camera.far = FLASHLIGHT.range;
    this.light.shadow.bias = -0.0016;

    this.target = new THREE.Object3D();
    this.light.target = this.target;

    scene.add(this.light);
    scene.add(this.target);
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
  }

  addBattery(amount) {
    this.battery = Math.min(FLASHLIGHT.maxBattery, this.battery + amount);
  }

  /** 좀비 감지 반경 배수 */
  get detectionMultiplier() {
    return this.on ? FLASHLIGHT.detectionMultiplier : 1;
  }
}
