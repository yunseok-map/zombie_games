/**
 * Throwables — 던진 물건이 **실제로 날아가고**, 화염병은 불웅덩이를 남긴다.
 *
 * ── 왜 새로 만들었나 ──────────────────────────────────────────────────
 * 예전 `_throw()` 는 던지는 순간 **9m 앞에 즉시** 피해와 소음을 만들었다.
 * 병이 날아가지도, 벽에 막히지도, 바닥에 떨어지지도 않았다. 그래서 화염병은
 * 화면에서 "9m 앞에서 보이지 않는 광역 피해"였고, 이름값을 못 해 컷했다.
 * 되살리려면 투사체·불꽃·화상 셋이 다 있어야 한다는 것이 그때의 결론이고,
 * 이 파일이 그 셋이다. 라디오도 같은 투사체를 타므로 같이 고쳐졌다.
 *
 * ── 성능 규칙 두 가지 (CLAUDE.md §3) ─────────────────────────────────
 * 1. **런타임 할당 0.** 투사체 메시도 불꽃 입자도 미리 다 만들어 두고 돌려쓴다.
 *    불꽃은 전부 하나의 Points 라 웅덩이가 몇 개든 **드로우콜 1개**다.
 * 2. **광원 개수를 고정한다.** three 의 셰이더 프로그램 캐시 키에 광원 개수가
 *    들어가서, 불이 붙을 때마다 광원을 추가하면 그 순간 씬의 재질이 통째로
 *    재컴파일된다 — 던질 때마다 화면이 멎는다. 그래서 등 2개를 처음부터
 *    씬에 두고 **세기만** 0↔n 으로 여닫는다 (Atmosphere._slots·moon 과 같은 수법).
 */

import * as THREE from 'three';
import { THROWABLE, FIRE, NOISE } from '../config/balance.js';
import { bus, EV } from '../core/EventBus.js';

const _v = new THREE.Vector3();

export class Throwables {
  /**
   * @param scene
   * @param collision   벽 판정 (isBlocked)
   * @param getZombies  지금 살아 있는 좀비 배열을 돌려주는 함수
   * @param player      불 안에 서 있으면 플레이어도 탄다
   */
  constructor(scene, collision, getZombies, player) {
    this.scene = scene;
    this.collision = collision;
    this.getZombies = getZombies;
    this.player = player;

    // ───────── 날아가는 물건 ─────────
    // 병 하나짜리 지오메트리·재질을 전부가 공유한다. 색만 인스턴스별로 바꾼다.
    const geo = new THREE.CylinderGeometry(0.05, 0.065, 0.22, 7);
    this.projectiles = [];
    for (let i = 0; i < THROWABLE.maxLive; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x2c4a2e, roughness: 0.35, metalness: 0.1,
        emissive: 0x000000,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.castShadow = false;
      scene.add(mesh);
      this.projectiles.push({
        mesh, mat, active: false, fire: false, t: 0,
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, def: null,
      });
    }

    // ───────── 불웅덩이 ─────────
    this.zones = [];
    for (let i = 0; i < FIRE.maxZones; i++) {
      // sfx: 타는 동안 그 자리에서 계속 나는 소리의 손잡이 (AudioManager.loop)
      this.zones.push({ active: false, x: 0, z: 0, t: 0, nextTick: 0, sfx: null });
    }
    /** Game 이 넣어 준다. 없으면 불은 조용히 탄다 (오디오 없이도 게임은 돌아간다) */
    this.audio = null;

    this._buildFlames();

    // 상주 광원. 개수 고정이 요점이다 (위 주석 2번)
    this.lights = [];
    for (let i = 0; i < FIRE.lights; i++) {
      const l = new THREE.PointLight(FIRE.lightColor, 0, FIRE.lightRange, 2);
      l.castShadow = false;      // 그림자는 손전등만 (성능 예산)
      scene.add(l);
      this.lights.push(l);
    }
  }

  /**
   * 불꽃 입자 — 하나의 Points 를 링버퍼로 돌린다. 웅덩이 수와 무관하게 드로우콜 1.
   *
   * 가산 합성이다. 피(Impact)와 반대로 불은 **빛나야** 한다 — 어두운 병원에서
   * 유일하게 스스로 빛나는 것이라, 이게 없으면 그냥 주황색 점이 깔린 바닥이다.
   */
  _buildFlames() {
    const N = FIRE.particles;
    this.pPos = new Float32Array(N * 3);
    this.pVel = new Float32Array(N * 3);
    this.pLife = new Float32Array(N);      // 남은 수명(초). 0 이면 죽은 것
    this.pAge = new Float32Array(N);       // 0→1 로 가는 정규화 나이 (셰이더가 색에 쓴다)
    this.pNext = 0;
    for (let i = 0; i < N; i++) this.pPos[i * 3 + 1] = -999;   // 처음엔 화면 밖

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('page', new THREE.BufferAttribute(this.pAge, 1));

    this.flameMat = new THREE.ShaderMaterial({
      uniforms: {
        uHot: { value: new THREE.Color(FIRE.colorHot) },
        uMid: { value: new THREE.Color(FIRE.colorMid) },
        uCold: { value: new THREE.Color(FIRE.colorCold) },
        uSize: { value: FIRE.partSize },
        uAlpha: { value: FIRE.partAlpha },
      },
      vertexShader: /* glsl */`
        attribute float page;
        varying float vA;
        uniform float uSize;
        void main() {
          vA = page;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          // 늙을수록 커지며 흩어진다 — 연기로 넘어가는 느낌
          gl_PointSize = (uSize * (0.45 + page * 0.9)) / max(-mv.z, 0.3);
        }`,
      fragmentShader: /* glsl */`
        varying float vA;
        uniform vec3 uHot;
        uniform vec3 uMid;
        uniform vec3 uCold;
        uniform float uAlpha;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d);
          if (r > 0.5) discard;
          /**
           * **가장자리를 아주 부드럽게.** 처음엔 smoothstep(0.5, 0.02, r) 이라
           * 중심 96% 가 평평한 원판이었고, 화면에서 불이 아니라 **떠 있는 구슬**로
           * 보였다. 제곱 감쇠로 바꾸면 낱개는 흐릿한 얼룩이 되고, 겹친 곳만
           * 밝아져서 하나의 불덩이로 읽힌다.
           */
          float core = 1.0 - r * 2.0;
          core *= core;
          // 심지(노랑) → 주황 → 적갈색
          vec3 c = mix(uHot, uMid, smoothstep(0.0, 0.42, vA));
          c = mix(c, uCold, smoothstep(0.42, 1.0, vA));
          // 끝에서 사그라든다. 가산이라 알파가 아니라 밝기로 죽여야 자연스럽다
          float fade = 1.0 - smoothstep(0.45, 1.0, vA);
          gl_FragColor = vec4(c * core * fade * uAlpha, 1.0);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.flames = new THREE.Points(geo, this.flameMat);
    this.flames.frustumCulled = false;    // 입자가 사방에 흩어져 경계상자가 의미 없다
    this.scene.add(this.flames);
  }

  /** 던진다. 카메라 앞에서 출발해 포물선을 그린다. */
  throwItem(def, camera, px, pz, eyeY) {
    const p = this.projectiles.find((q) => !q.active)
      // 다 쓰고 있으면 가장 오래된 것을 재활용한다. 던진 게 안 나가는 것보다 낫다
      || this.projectiles.reduce((a, b) => (a.t > b.t ? a : b));

    _v.set(0, 0, -1).applyQuaternion(camera.quaternion);
    p.x = px + _v.x * THROWABLE.handOffset;
    p.y = eyeY + _v.y * THROWABLE.handOffset;
    p.z = pz + _v.z * THROWABLE.handOffset;
    p.vx = _v.x * THROWABLE.speed;
    p.vy = _v.y * THROWABLE.speed + THROWABLE.speed * THROWABLE.lift;
    p.vz = _v.z * THROWABLE.speed;
    p.active = true;
    p.t = 0;
    p.def = def;
    p.fire = !def.lure;      // 화염병만 불을 남긴다
    p.mat.color.setHex(p.fire ? 0x2c4a2e : 0x554e46);
    // 불붙은 심지 — 날아가는 동안 스스로 빛난다. 어두운 복도에서 궤적이 보인다
    p.mat.emissive.setHex(p.fire ? 0xff6a1a : 0x000000);
    p.mesh.visible = true;
    p.mesh.position.set(p.x, p.y, p.z);
  }

  /** 구역이 바뀌면 전부 지운다 — 이전 구역의 불이 따라오면 안 된다 */
  clear() {
    for (const p of this.projectiles) { p.active = false; p.mesh.visible = false; }
    for (const z of this.zones) { z.active = false; z.sfx?.stop(); z.sfx = null; }
    for (const l of this.lights) l.intensity = 0;
    for (let i = 0; i < FIRE.particles; i++) {
      this.pLife[i] = 0;
      this.pPos[i * 3 + 1] = -999;
    }
    this.flames.geometry.attributes.position.needsUpdate = true;
  }

  update(dt) {
    this._moveProjectiles(dt);
    this._burn(dt);
    this._moveParticles(dt);
    this._aimLights();
  }

  // ───────────────────── 날아가는 동안 ─────────────────────
  _moveProjectiles(dt) {
    for (const p of this.projectiles) {
      if (!p.active) continue;
      p.t += dt;

      const nx = p.x + p.vx * dt;
      const ny = p.y + p.vy * dt;
      const nz = p.z + p.vz * dt;
      p.vy -= THROWABLE.gravity * dt;

      // 벽에 맞으면 **거기서** 깨진다. 예전에는 벽을 통과해 9m 뒤에 피해가 생겼다
      if (this.collision.isBlocked(nx, nz, THROWABLE.radius)) { this._land(p, p.x, p.z); continue; }
      if (ny <= 0.06) { this._land(p, nx, nz); continue; }
      if (p.t >= THROWABLE.maxFlight) { this._land(p, nx, nz); continue; }

      p.x = nx; p.y = ny; p.z = nz;
      p.mesh.position.set(nx, ny, nz);
      p.mesh.rotation.x += THROWABLE.spin * dt;
      p.mesh.rotation.z += THROWABLE.spin * 0.6 * dt;

      // 화염병은 날아가는 동안 심지에서 불티가 떨어진다 — 궤적이 눈에 남는다
      if (p.fire) this._spawnParticle(nx, ny, nz, 0.35);
    }
  }

  _land(p, x, z) {
    p.active = false;
    p.mesh.visible = false;
    const def = p.def;

    if (def?.lure) {
      // 라디오 — 소리를 내서 좀비를 그쪽으로 끈다 (전투 회피 도구)
      bus.emit(EV.NOISE, { x, z, radius: def.lureRadius, source: 'lure' });
      bus.emit(EV.SFX, { name: 'radio_static', x, z, volume: 1 });
      bus.emit(EV.HINT, { text: '라디오를 던졌다', duration: 1.6 });
      return;
    }

    this._ignite(x, z);
    bus.emit(EV.SFX, { name: 'molotov_break', x, z, volume: 1 });
    bus.emit(EV.NOISE, { x, z, radius: NOISE.melee, source: 'throw' });
  }

  /** 불웅덩이를 하나 만든다. 자리가 없으면 가장 오래 탄 것을 밀어낸다 */
  _ignite(x, z) {
    let zone = this.zones.find((q) => !q.active);
    if (!zone) zone = this.zones.reduce((a, b) => (a.t > b.t ? a : b));
    zone.sfx?.stop();                 // 밀려난 웅덩이의 소리가 남으면 안 된다
    zone.sfx = this.audio?.loop('fire_loop', { x, z, volume: 0.85 }) ?? null;
    zone.active = true;
    zone.x = x; zone.z = z;
    zone.t = 0;
    zone.nextTick = FIRE.ignite;    // 붙는 데 시간이 걸린다 — 던지자마자 피해가 아니다
    // 확 번지는 순간. 한 번에 뿌려야 "붙었다"가 읽힌다
    for (let i = 0; i < 90; i++) this._spawnParticle(x, 0.1, z, 1.6);
  }

  // ───────────────────── 타는 동안 ─────────────────────
  _burn(dt) {
    const r2 = FIRE.radius * FIRE.radius;
    for (const zone of this.zones) {
      if (!zone.active) continue;
      zone.t += dt;
      if (zone.t >= FIRE.burnSeconds) {
        zone.active = false;
        zone.sfx?.stop(); zone.sfx = null;
        continue;
      }

      // 사그라들 때는 입자도 같이 줄인다. 뚝 끊기면 불이 "삭제"된 것처럼 보인다
      const tail = Math.min(1, (FIRE.burnSeconds - zone.t) / 1.4);
      // 소리도 같은 곡선으로 줄인다. **매 프레임** 불러야 한다 — 불은 제자리라도
      // 플레이어가 움직이므로 거리·좌우가 계속 바뀐다
      zone.sfx?.at(zone.x, zone.z, tail);
      const n = FIRE.spawnRate * dt * tail;
      let count = Math.floor(n);
      if (Math.random() < n - count) count++;
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(Math.random()) * FIRE.radius * FIRE.spread;
        this._spawnParticle(zone.x + Math.cos(a) * rr, 0.05, zone.z + Math.sin(a) * rr, 1);
      }

      // 피해는 초당이 아니라 **박자**로 준다. 매 프레임 조금씩 깎으면
      // 체력바가 스르르 녹아서 "불에 탔다"가 아니라 "버그"로 보인다.
      zone.nextTick -= dt;
      if (zone.nextTick > 0) continue;
      zone.nextTick += FIRE.tick;

      for (const zb of this.getZombies()) {
        if (!zb.active || zb.state === 'DEAD') continue;
        const dx = zb.pos.x - zone.x, dz = zb.pos.z - zone.z;
        if (dx * dx + dz * dz > r2) continue;
        zb.burn(FIRE.dps * FIRE.tick);
        for (let i = 0; i < FIRE.emberOnHit; i++) {
          this._spawnParticle(zb.pos.x, 0.6 + Math.random() * 0.9, zb.pos.z, 1.1);
        }
      }

      // **플레이어도 탄다.** 안 그러면 통로에 던져 놓고 뒤에 서 있는 무적 버튼이 된다
      const px = this.player.pos.x - zone.x, pz = this.player.pos.z - zone.z;
      if (px * px + pz * pz <= r2) this.player.damage(FIRE.playerDps * FIRE.tick);
    }
  }

  // ───────────────────── 입자 ─────────────────────
  /** @param power 1 = 웅덩이 기본. 작으면 약하게 튄다 */
  _spawnParticle(x, y, z, power) {
    const i = this.pNext;
    this.pNext = (this.pNext + 1) % FIRE.particles;
    const o = i * 3;
    this.pPos[o] = x; this.pPos[o + 1] = y; this.pPos[o + 2] = z;
    this.pVel[o] = (Math.random() - 0.5) * FIRE.drift * power;
    this.pVel[o + 1] = FIRE.rise * (0.55 + Math.random() * 0.75) * power;
    this.pVel[o + 2] = (Math.random() - 0.5) * FIRE.drift * power;
    this.pLife[i] = FIRE.partLife * (0.7 + Math.random() * 0.6);
    this.pAge[i] = 0;
  }

  _moveParticles(dt) {
    const N = FIRE.particles;
    let any = false;
    for (let i = 0; i < N; i++) {
      const life = this.pLife[i];
      if (life <= 0) continue;
      any = true;
      const rest = life - dt;
      const o = i * 3;
      if (rest <= 0) {
        this.pLife[i] = 0;
        this.pPos[o + 1] = -999;        // 죽은 입자는 화면 밖으로 치운다
        this.pAge[i] = 1;
        continue;
      }
      this.pLife[i] = rest;
      // 뜨거운 공기는 위로 갈수록 느려지고 옆으로 퍼진다
      this.pVel[o + 1] *= 1 - dt * 1.1;
      this.pPos[o] += this.pVel[o] * dt;
      this.pPos[o + 1] += this.pVel[o + 1] * dt;
      this.pPos[o + 2] += this.pVel[o + 2] * dt;
      this.pAge[i] = 1 - rest / FIRE.partLife;
    }
    if (!any) return;
    this.flames.geometry.attributes.position.needsUpdate = true;
    this.flames.geometry.attributes.page.needsUpdate = true;
  }

  // ───────────────────── 빛 ─────────────────────
  /** 상주 광원을 켜져 있는 웅덩이에 배정한다. 남는 등은 세기 0 (개수는 안 바꾼다) */
  _aimLights() {
    let n = 0;
    for (const zone of this.zones) {
      if (!zone.active || n >= this.lights.length) continue;
      const l = this.lights[n++];
      l.position.set(zone.x, 0.75, zone.z);
      // 사그라들면 빛도 같이 죽는다. 흔들림이 없으면 주황색 전구로 보인다
      const tail = Math.min(1, (FIRE.burnSeconds - zone.t) / 1.4);
      const flick = 1 - FIRE.lightFlicker * Math.random();
      l.intensity = FIRE.lightIntensity * tail * flick;
    }
    for (; n < this.lights.length; n++) this.lights[n].intensity = 0;
  }
}
