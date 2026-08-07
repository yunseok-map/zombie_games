import * as THREE from 'three';
import { FX } from '../config/balance.js';

/**
 * Atmosphere — 포그 · 앰비언트 · 비상등.
 * 공포의 8할이 여기서 나온다. (CLAUDE.md §5)
 * 원칙: 기본은 완전한 어둠. 빛은 예외적으로만 존재한다.
 */
/** 슬롯 정렬용. 인라인으로 쓰면 매 프레임 클로저가 하나씩 생긴다 */
const byNear = (a, b) => a._d - b._d;

export class Atmosphere {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    /**
     * 비상등 **기록**. THREE 광원이 아니라 좌표·색·모드만 든 평범한 객체다.
     * 실제로 씬에 있는 광원은 아래 `_slots` 뿐이고, 매 프레임 지금 중요한
     * 기록들을 슬롯에 실어 보낸다. (이유는 `_assignSlots` 주석)
     */
    this.emergencyLights = [];
    this._t = 0;

    /**
     * **고정 슬롯.** 개수가 절대 안 변하는 것이 이 구조의 요점이다.
     *
     * 두 가지를 동시에 고친다.
     *  (1) 전방 렌더라 셰이더가 **픽셀마다 광원 전부를 돈다.** 2F 병동은 광원이
     *      14개인데, 한 지점에서 사거리(7m) 안에 실제로 드는 것은 최대 4개였다
     *      (전 구역 격자 표본). 나머지 10개는 매 픽셀 계산되고 0 을 더한다.
     *      실측: 14개 → 5개로 줄이면 GPU 프레임의 15% 가 빠진다.
     *  (2) three 의 프로그램 캐시 키에 **광원 개수가 들어간다**(three.module.js
     *      의 numPointLights). 구역마다 12 → 6 → 14 → 9 → 5 로 바뀌니 구역을 옮길
     *      때마다 씬의 재질이 통째로 재컴파일됐다 — 프로그램 누적 68 → 200.
     *      개수를 고정하면 이 재컴파일이 사라진다.
     *
     * 안 쓰는 슬롯은 `visible = false` 가 아니라 **intensity 0** 이다.
     * visible 을 끄면 개수가 다시 흔들려서 (2) 가 그대로 돌아온다.
     *
     * 슬롯 수는 실측으로 정했다: 5개면 전부 켠 화면과 **픽셀 단위로 동일**했고
     * (세 구역 x 여섯 시점, 최대 차이 0), 4개는 1F 에서 눈에 띄게 어두워졌다.
     * 6개는 거기에 여유 한 칸이다. (scratchpad/qa/light_visual.mjs)
     */
    this._slots = [];
    for (let i = 0; i < FX.emergencyLightSlots; i++) {
      const l = new THREE.PointLight(0xffffff, 0,
        FX.emergencyLightRange, FX.emergencyLightDecay);
      l.castShadow = false;      // 그림자는 손전등만 (성능 예산 CLAUDE.md §3)
      scene.add(l);
      this._slots.push(l);
    }
    this._frustum = new THREE.Frustum();
    this._pv = new THREE.Matrix4();
    this._sphere = new THREE.Sphere(new THREE.Vector3(), FX.emergencyLightRange);
    this._cand = [];

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
    // 광원을 만들지 않는다 — **자리와 성격만 적어 둔다.** 실제 광원은 슬롯이 맡는다
    const e = {
      x, y, z, mode,
      color: new THREE.Color(color),
      base: FX.emergencyLightIntensity,
      seed: Math.random() * 100,
      nextFlicker: 0,
      value: 1,
      _d: 0,                 // 슬롯 배정용 거리² (매 프레임 갱신)
    };
    this.emergencyLights.push(e);
    return e;
  }

  clearLights() {
    this.emergencyLights.length = 0;
    for (const l of this._slots) l.intensity = 0;   // 슬롯은 씬에 남는다 (개수 고정)
  }

  /**
   * 지금 화면에 영향을 줄 수 있는 비상등을 골라 슬롯에 싣는다.
   *
   * PointLight 는 `distance`(7m) 밖을 **전혀** 밝히지 않는다. 그러므로 광원을 중심으로
   * 한 반지름 7m 구가 카메라 절두체와 안 겹치면 그 광원은 화면에 정확히 0 을 더한다 —
   * 등 뒤의 불빛을 슬롯에 태울 이유가 없다. three 는 전방 렌더라 이 판정을 안 한다.
   *
   * 절두체는 **지난 프레임 기준**이다(카메라 행렬이 렌더에서 갱신되므로).
   * 한 프레임 늦게 들어오는 광원은 화면 가장자리에 있어서 눈에 띄지 않는다.
   */
  _assignSlots(camera) {
    const slots = this._slots;
    const list = this.emergencyLights;
    const cand = this._cand;
    cand.length = 0;

    if (camera) {
      this._pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this._frustum.setFromProjectionMatrix(this._pv);
      for (const e of list) {
        this._sphere.center.set(e.x, e.y, e.z);
        if (!this._frustum.intersectsSphere(this._sphere)) continue;
        e._d = camera.position.distanceToSquared(this._sphere.center);
        cand.push(e);
      }
      // 슬롯보다 후보가 많을 때만 정렬한다. 보통은 4개 이하라 여기까지 안 온다
      if (cand.length > slots.length) cand.sort(byNear);
    } else {
      for (let i = 0; i < list.length && i < slots.length; i++) cand.push(list[i]);
    }

    for (let i = 0; i < slots.length; i++) {
      const l = slots[i], e = cand[i];
      if (!e) { l.intensity = 0; continue; }
      l.position.set(e.x, e.y, e.z);
      l.color.copy(e.color);
      l.intensity = e.base * e.value;
    }
  }

  /** @param camera 슬롯 배정에 쓴다. 없으면 앞에서부터 채운다(구도를 모를 때) */
  update(dt, camera = null) {
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
    }
    this._assignSlots(camera);
  }
}
