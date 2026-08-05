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

    this._buildEnvironment();
  }

  /**
   * 아주 약한 환경맵.
   *
   * 없으면 금속·유리가 **반사할 것이 없어 새까맣게 죽는다** — 링거대 봉이나 침대
   * 프레임이 실루엣만 남아 종이처럼 보이는 원인이 이것이다.
   * 다만 환경맵은 사방에서 들어오는 빛이라 세게 넣으면 어둠이 통째로 걷혀 버린다.
   * 그래서 `FX.envIntensity` 로 아주 낮게 눌러, **형태를 읽히게 하는 정도**만 쓴다.
   */
  _buildEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    // 실내용 저해상도 큐브맵을 직접 만든다 (외부 HDR 을 받지 않는다 — CLAUDE.md §1-6)
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const grd = ctx.createLinearGradient(0, 0, 0, 64);
    grd.addColorStop(0, '#2a3138');      // 천장 쪽이 조금 밝다
    grd.addColorStop(0.55, '#141a1f');
    grd.addColorStop(1, '#0a0d10');      // 바닥은 거의 검정
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;

    this.scene.environment = pmrem.fromEquirectangular(tex).texture;
    if ('environmentIntensity' in this.scene) {
      this.scene.environmentIntensity = FX.envIntensity;
    }
    tex.dispose();
    pmrem.dispose();
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
