import * as THREE from 'three';
import { FX } from '../config/balance.js';

/**
 * Atmosphere — 포그 · 앰비언트 · 비상등.
 * 공포의 8할이 여기서 나온다. (CLAUDE.md §5)
 * 원칙: 기본은 완전한 어둠. 빛은 예외적으로만 존재한다.
 */
export class Atmosphere {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.emergencyLights = [];
    this._t = 0;

    scene.fog = new THREE.FogExp2(FX.fogColor, FX.fogDensity);
    scene.background = new THREE.Color(FX.fogColor);

    this.ambient = new THREE.AmbientLight(0x6a7a86, FX.ambientIntensity);
    scene.add(this.ambient);

    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = FX.exposure;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  /** 구역별 분위기 덮어쓰기 — StageLoader 가 호출 */
  applyStageMood({ fogDensity, fogColor, ambientIntensity }) {
    if (fogColor !== undefined) {
      this.scene.fog.color.setHex(fogColor);
      this.scene.background.setHex(fogColor);
    }
    if (fogDensity !== undefined) this.scene.fog.density = fogDensity;
    if (ambientIntensity !== undefined) this.ambient.intensity = ambientIntensity;
  }

  /**
   * 비상등 — 그림자를 드리우지 않는다 (성능 예산: 그림자 광원 ≤2).
   * @param {'steady'|'flicker'|'pulse'} mode
   */
  addEmergencyLight(x, y, z, mode = 'flicker', color = FX.emergencyLightColor) {
    const light = new THREE.PointLight(
      color, FX.emergencyLightIntensity, FX.emergencyLightRange, 1.6
    );
    light.position.set(x, y, z);
    light.castShadow = false;
    this.scene.add(light);
    this.emergencyLights.push({
      light,
      mode,
      base: FX.emergencyLightIntensity,
      seed: Math.random() * 100,
      nextFlicker: 0,
      value: 1,
    });
    return light;
  }

  clearLights() {
    for (const e of this.emergencyLights) this.scene.remove(e.light);
    this.emergencyLights.length = 0;
  }

  update(dt) {
    this._t += dt;
    for (const e of this.emergencyLights) {
      if (e.mode === 'steady') continue;
      if (e.mode === 'pulse') {
        e.value = 0.55 + 0.45 * Math.sin(this._t * 1.7 + e.seed);
      } else {
        e.nextFlicker -= dt;
        if (e.nextFlicker <= 0) {
          e.nextFlicker = 0.06 + Math.random() * 0.5;
          e.value = Math.random() < 0.22 ? 0.08 + Math.random() * 0.25 : 0.85 + Math.random() * 0.3;
        }
      }
      e.light.intensity = e.base * e.value;
    }
  }
}
