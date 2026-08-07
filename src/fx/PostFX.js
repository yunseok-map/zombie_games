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
    uHurt: { value: 0 },
    uHurtDesat: { value: POST.hurtDesat },
    uHurtAber: { value: POST.hurtAberration },
    uHurtVig: { value: POST.hurtVignette },
    uHurtTint: { value: POST.hurtTint },
    uHurtRim: { value: POST.hurtRim },
    uHurtRimBase: { value: POST.hurtRimBase },
    uHurtEdge0: { value: POST.hurtEdgeStart },
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
    uniform float uHurt;        // 0..1 — 맞은 직후 부풀었다가 감쇠한다
    uniform float uHurtDesat;
    uniform float uHurtAber;
    uniform float uHurtVig;
    uniform float uHurtTint;
    uniform float uHurtRim;      // 가장자리로 갈수록 붉어지는 정도
    uniform float uHurtRimBase;  // 화면 전체에 깔리는 최소한
    uniform float uHurtEdge0;    // 이 r² 부터 붉어지기 시작한다 (안쪽은 그대로)
    varying vec2 vUv;

    float rand(vec2 c) {
      return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);

      // 색수차 — 화면 가장자리에서만 채널이 어긋난다 (싸구려 렌즈 느낌)
      // 맞으면 이 어긋남이 순간적으로 커진다. 초점이 나간 것처럼 보인다.
      float a = (uAberration + uHurtAber * uHurt) * r2;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv - d * a).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv + d * a).b;

      // 비네트 — 손전등 밖의 어둠을 더 밀어붙인다. 맞으면 시야가 좁아진다
      col *= 1.0 - (uVignette + uHurtVig * uHurt) * r2 * 2.4;

      // 필름 그레인 — 어두운 영역에서 강해진다. 실제 센서 노이즈가 그렇다
      float lum = dot(col, vec3(0.299, 0.587, 0.114));

      // 피격 — 채도가 빠지면서 붉은 기가 가장자리에서 밀려든다.
      //
      // **더하기여야 한다.** 처음에는 전부 곱셈으로 짰다(채도 하락·비네트·색수차).
      // 그런데 이 게임에서 맞는 순간은 대부분 손전등 밖의 칠흑이고,
      // **검정에 무엇을 곱해도 검정이다** — 화면에 아무 일도 안 일어났다.
      // (증거: scratchpad/qa/s3_05_hurt_before.png 와 s3_06_hurt_after.png 가 구분이 안 된다)
      // 그래서 화면 밝기와 무관한 항을 하나 더한다. 가운데는 약하게, 가장자리로
      // 갈수록 세게 — 시야가 좁아지며 붉게 닫히는 느낌이 된다.
      if (uHurt > 0.0) {
        vec3 grey = vec3(lum);
        col = mix(col, grey, uHurtDesat * uHurt);
        // **가장자리에만 몰아준다.** r² 를 그대로 쓰면 화면 한가운데까지 붉어져서
        // "빨간 판을 덮었다"가 된다(실측: 평균 빨강 3 → 118, 사실상 빨간 필터).
        // 화면 가운데 40% 는 건드리지 않고 구석으로 갈수록 급히 올린다.
        float edge = smoothstep(uHurtEdge0, 0.5, r2);
        col.r += uHurtTint * uHurt * (uHurtRimBase + edge * uHurtRim);
      }
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
    // **적응형 해상도가 여기까지 와야 한다.** EffectComposer 는 만들어질 때의
    // pixelRatio 를 내부에 붙잡아 두고 setSize 에서 그 값을 곱한다. 이걸 갱신하지 않으면
    // Game._adaptResolution 이 배율을 0.75 로 낮춰도 씬과 후처리는 계속 1.5 배로 그려진다 —
    // 즉 약한 PC 를 위한 안전장치가 통째로 무효가 된다. (측정: 2379x1125 44.3ms vs 1600x900 18.3ms)
    const r = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(r);
    this.composer.setSize(w, h);

    // 블룸·AO 는 흐린 신호라 낮은 해상도로 구워도 티가 안 난다. 실제 렌더 해상도 기준으로 잡는다.
    const ew = w * r, eh = h * r;
    this.bloom.setSize(Math.round(ew * POST.bloomScale), Math.round(eh * POST.bloomScale));
    this.ao?.setSize(Math.round(ew * POST.aoScale), Math.round(eh * POST.aoScale));
  }

  /** 맞았다. 화면이 한 번 흐트러진다. (Game 이 PLAYER_DAMAGED 에서 부른다) */
  hurt(amount = 1) {
    const u = this.grain.uniforms.uHurt;
    u.value = Math.min(1, u.value + POST.hurtPulse * amount);
  }

  render(dt) {
    this.grain.uniforms.uTime.value += dt;

    // 감쇠는 여기서 한다. 후처리가 꺼져 있으면 render 자체가 안 불리지만,
    // 그때는 uHurt 를 읽는 셰이더도 안 돌아가므로 남아 있어도 보이지 않는다.
    const u = this.grain.uniforms.uHurt;
    if (u.value > 0) u.value = Math.max(0, u.value - POST.hurtDecay * dt);

    this.composer.render(dt);
  }
}
