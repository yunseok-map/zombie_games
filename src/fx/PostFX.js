import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { POST } from '../config/balance.js';

/**
 * PostFX — 렌더 결과에 필름 질감을 입힌다.
 * 텍스처가 "무엇이 있는가"를 만든다면, 여기는 "카메라로 찍은 것처럼 보이는가"를 만든다.
 * 순서: 씬 → 블룸 → (색수차·비네트·그레인) → 톤매핑/색공간
 *
 * 값은 전부 config/balance.js 의 POST 에 있다. (CLAUDE.md §1-1)
 */

const GrainVignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: POST.grain },
    uVignette: { value: POST.vignette },
    uAberration: { value: POST.aberration },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uAberration;
    varying vec2 vUv;

    float rand(vec2 c) {
      return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);

      // 색수차 — 화면 가장자리에서만 채널이 어긋난다 (싸구려 렌즈 느낌)
      float a = uAberration * r2;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv - d * a).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv + d * a).b;

      // 비네트 — 손전등 밖의 어둠을 더 밀어붙인다
      col *= 1.0 - uVignette * r2 * 2.4;

      // 필름 그레인 — 어두운 영역에서 강해진다. 실제 센서 노이즈가 그렇다
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      float n = rand(vUv * (1.0 + fract(uTime * 0.37))) - 0.5;
      col += n * uGrain * (1.0 - lum);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.enabled = POST.enabled;

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    // HalfFloat + MSAA — 블룸은 선형 공간에서 계산해야 번짐이 자연스럽다
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: POST.msaaSamples,
    });

    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));

    // 앰비언트 오클루전 — 물체가 바닥·벽에 "닿아 보이게" 만드는 요소.
    // 이게 없으면 소품이 바닥 위에 떠 있는 스티커처럼 보인다.
    // 후처리 AO 라서 손전등이 만든 밝은 영역의 틈새에도 걸린다(재질의 aoMap 과 다르다).
    if (POST.ao) {
      // AO 는 절반 해상도로 굽는다. 전체 해상도로 하면 프레임이 배로 든다
      // (측정: 14.5ms → 30.2ms). AO 는 부드러운 신호라 절반이어도 티가 잘 안 난다.
      this.ao = new GTAOPass(scene, camera,
        Math.round(size.x * POST.aoScale), Math.round(size.y * POST.aoScale));
      this.ao.output = GTAOPass.OUTPUT.Default;
      this.ao.updateGtaoMaterial({
        radius: POST.aoRadius,
        distanceExponent: 1.0,
        thickness: 1.0,
        scale: POST.aoStrength,
        samples: POST.aoSamples,
      });
      this.composer.addPass(this.ao);
    }

    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      POST.bloomStrength, POST.bloomRadius, POST.bloomThreshold
    );
    this.composer.addPass(this.bloom);

    this.grain = new ShaderPass(GrainVignetteShader);
    this.composer.addPass(this.grain);

    // 톤매핑·sRGB 변환은 마지막에 한 번만. renderer 설정을 그대로 따른다
    this.composer.addPass(new OutputPass());
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.ao?.setSize(Math.round(w * POST.aoScale), Math.round(h * POST.aoScale));
  }

  render(dt) {
    this.grain.uniforms.uTime.value += dt;
    this.composer.render(dt);
  }
}
