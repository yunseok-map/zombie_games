import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SURFACE, LOOT, CORPSE, SCATTER, KEY_ITEM_GLOW } from '../config/balance.js';
import { WEAPONS } from '../config/weapons.js';
import { bus, EV } from '../core/EventBus.js';
import { Scatter, BloodDecals } from './Scatter.js';
import { BUILDERS, signPlate } from './Props.js';
import { propModels, pickFile } from './PropModels.js';

const SIGN_COLS = 4, SIGN_ROWS = 4;   // signage_atlas.webp 분할 (gen_signage.py 와 맞춰야 한다)

/**
 * StageLoader — 구역을 짓고, 지우고, 충돌/스폰/조명을 등록한다.
 * 구역 정의(stages/*.js)는 "무엇을 어디에" 만 말하고, 실제 생성은 전부 여기서 한다.
 * 덕분에 구역 파일이 데이터에 가까워져서 수정이 안전하다.
 */
const WALL_H = 3.1;

const TEX_DIR = `${import.meta.env.BASE_URL}assets/textures/`;
const texLoader = new THREE.TextureLoader();

/** 한 재질에 필요한 맵 3종(색·요철·거칠기)을 불러온다. 텍스처는 전 구역이 공유한다. */
function loadMaps(name, dir = 'surfaces') {
  const map = texLoader.load(`${TEX_DIR}${dir}/${name}_color.webp`);
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = texLoader.load(`${TEX_DIR}${dir}/${name}_normal.webp`);
  const roughnessMap = texLoader.load(`${TEX_DIR}${dir}/${name}_rough.webp`);
  for (const t of [map, normalMap, roughnessMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;   // UV 가 1을 넘어도 반복되게
    t.anisotropy = SURFACE.anisotropy;
  }
  return { map, normalMap, roughnessMap };
}

function makeMat(maps, tint, normalScale) {
  return new THREE.MeshStandardMaterial({
    ...maps,
    color: tint,
    roughness: 1,          // roughnessMap 에 곱해진다
    metalness: 0,
    normalScale: new THREE.Vector2(normalScale, normalScale),
  });
}

/**
 * 박스 UV 를 실제 크기에 맞춘다. 이걸 안 하면 텍스처가 벽 크기대로 늘어나서
 * 긴 복도 벽 하나에 무늬가 딱 한 번만 나온다 — 그게 "종이 같아 보이는" 원인이다.
 * BoxGeometry 면 순서: +X, -X, +Y, -Y, +Z, -Z (면당 정점 4개)
 */
function fitBoxUV(geo, w, h, d, tile) {
  const uv = geo.attributes.uv;
  const faceSize = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = faceSize[f];
    for (let i = f * 4; i < f * 4 + 4; i++) {
      uv.setXY(i, (uv.getX(i) * su) / tile, (uv.getY(i) * sv) / tile);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

/**
 * 소품 부품 UV — 박스든 실린더든 크기에 맞춰 균일하게 늘린다.
 * 안 하면 3cm 짜리 부품에 텍스처 한 장이 통째로 들어가 노이즈처럼 보인다.
 */
/**
 * 소품 UV — 면이 바라보는 축을 빼고 나머지 두 축의 **실제 좌표**를 그대로 UV 로 쓴다
 * (박스 프로젝션). 그래야 크기가 다른 소품끼리도 텍셀 밀도가 같아진다.
 *
 * 예전에는 가장 긴 변 하나로 U·V 를 함께 스케일했다. 그러면 문틀 기둥처럼
 * 얇고 긴 물체에서 짧은 쪽 면이 4cm 마다 반복돼 물결무늬(모아레)가 생겼다.
 * **회전·이동 전에 불러야 한다** — 로컬 좌표 기준이다.
 */
function fitGenericUV(geo, tile) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  if (!pos || !nor) return geo;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let u, v;
    if (ax >= ay && ax >= az) { u = z; v = y; }        // 옆면
    else if (ay >= az) { u = x; v = z; }               // 윗·아랫면
    else { u = x; v = y; }                             // 앞·뒷면
    uv[i * 2] = u / tile;
    uv[i * 2 + 1] = v / tile;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

function fitPlaneUV(geo, w, d, tile) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * d) / tile);
  }
  uv.needsUpdate = true;
  return geo;
}

export class StageLoader {
  constructor(scene, collision, atmosphere, director, interaction) {
    this.scene = scene;
    this.collision = collision;
    this.atmosphere = atmosphere;
    this.director = director;
    this.interaction = interaction;
    this.group = null;
    this.spawnPoints = [];
    this.exit = null;
    // B1 발전기를 살리면 그 뒤로 여는 구역은 `meta.poweredMood` 를 얹은 채로 열린다.
    // 구역 로드보다 먼저 서 있어야 하는 상태라 여기서 받는다 (load() 가 읽는다).
    this._power = false;
    bus.on(EV.POWER_RESTORED, () => { this._power = true; });

    // 좀비가 죽은 자리에 핏자국을 남긴다. 시체는 30초 뒤 사라지지만 자국은 남아서
    // "여기서 싸웠다"가 지도처럼 읽힌다 — 되돌아왔을 때 길을 아는 단서가 된다.
    //
    // 예전에는 자국 하나가 메시 하나 = **드로우콜 하나**였다. 상한이 22였으니
    // 잘 싸운 판에서는 예산(300)의 7%를 핏자국이 먹었다. 인스턴싱으로 묶으면
    // 개수와 무관하게 1개다 — 그래서 상한도 넉넉히 올릴 수 있다.
    // 이건 구역 그룹이 아니라 씬에 붙는다(구역 전환 때 clear 로 지운다).
    // (실제 생성은 scatter 를 만든 뒤 — 재질·지오메트리를 거기서 빌린다)
    bus.on(EV.ZOMBIE_DIED, ({ x, z }) => {
      if (this.group) this.killMarks?.stamp(x, z);
    });

    // 텍스처·재질은 전 구역이 공유한다 (메모리 예산 — CLAUDE.md §3)
    this.tex = {
      wall: loadMaps('wall_plaster_peeling'),
      floor: loadMaps('floor_tile_hospital'),
      ceiling: loadMaps('ceiling_panel_office'),
    };
    this.mat = {
      floor: makeMat(this.tex.floor, SURFACE.floorTint, SURFACE.floorNormalScale),
      wall: makeMat(this.tex.wall, SURFACE.wallTint, SURFACE.wallNormalScale),
      ceiling: makeMat(this.tex.ceiling, SURFACE.ceilingTint, SURFACE.ceilingNormalScale),
    };
    // 소품용 재질. 손전등이 26cd 라 알베도가 높으면 가까이서 하얗게 탄다 —
    // 벽(텍스처 반영 후 ~0.35)과 비슷한 밝기로 맞춘다.
    const M = (o) => new THREE.MeshStandardMaterial(o);
    const signMap = texLoader.load(`${TEX_DIR}signage/signage_atlas.webp`);
    signMap.colorSpace = THREE.SRGBColorSpace;
    signMap.anisotropy = SURFACE.anisotropy;

    // 소품 전용 PBR 세트 (ambientCG CC0). 벽 맵을 돌려쓰면 소품이 석고처럼 보인다.
    //   prop_enamel  PaintedMetal013 — 칠이 벗겨진 흰 도장철판. 병상·캐비닛·문
    //   prop_metal   Metal038        — 긁힌 어두운 강철. 레일·링거대·바퀴
    //   prop_fabric  Fabric045       — 거친 직물. 매트리스·커튼
    this.tex.enamel = loadMaps('prop_enamel', 'props');
    this.tex.metal = loadMaps('prop_metal', 'props');
    this.tex.fabric = loadMaps('prop_fabric', 'props');
    const N = (k) => new THREE.Vector2(k, k);

    Object.assign(this.mat, {
      metal:      M({ ...this.tex.metal,  color: 0x8a929a, roughness: 1, metalness: 0.75, normalScale: N(0.9) }),
      enamel:     M({ ...this.tex.enamel, color: 0x7d837c, roughness: 1, metalness: 0.15, normalScale: N(1.0) }),
      fabric:     M({ ...this.tex.fabric, color: 0x6e6b61, roughness: 1, metalness: 0,    normalScale: N(1.1) }),
      accent:     M({ ...this.tex.enamel, color: 0x9a3226, roughness: 1, metalness: 0.10, normalScale: N(0.9) }),
      accentDark: M({ ...this.tex.metal,  color: 0x40464a, roughness: 1, metalness: 0.25, normalScale: N(0.8) }),
      glass:      M({ color: 0x9aa8b0, roughness: 0.08, metalness: 0.1,
                      transparent: true, opacity: 0.20, depthWrite: false }),
      sheer:      M({ ...this.tex.fabric, color: 0x4a4d47, roughness: 1,
                      transparent: true, opacity: 0.42, depthWrite: false,
                      side: THREE.DoubleSide, normalScale: new THREE.Vector2(0.5, 0.5) }),
      lamp:       M({ color: 0x1a1e22, emissive: 0xbcd6ff, emissiveIntensity: 0.85, roughness: 0.4 }),
      plate:      M({ map: signMap, color: 0x8e8e8e, roughness: 0.62, metalness: 0.05 }),
      plateGlow:  M({ map: signMap, color: 0x5a5a5a, emissiveMap: signMap,
                      emissive: 0xffffff, emissiveIntensity: 1.1, roughness: 0.6 }),
    });

    this.propMats = new Map();
    this.scatter = new Scatter();
    // 사망 자국 — 옅어지지 않고, 구역이 바뀔 때만 지워진다.
    // scatter 가 이미 읽어 둔 데칼 재질·지오메트리를 그대로 빌린다 (새 에셋 0).
    this.killMarks = new BloodDecals(this.scene, this.scatter.decalMat.pool,
      this.scatter.decalGeo, {
        count: SCATTER.killMarkMax, fade: 0,
        sizeMin: CORPSE.bloodSize * SCATTER.killMarkSizeMin,
        sizeMax: CORPSE.bloodSize * SCATTER.killMarkSizeMax,
        y: SCATTER.killMarkY,
      });
  }

  /** 아이템은 어두운 복도에서 찾을 수 있어야 한다 — 약하게 발광시킨다 (블룸이 받아준다) */
  _itemMat() {
    if (!this._itemMaterial) {
      this._itemMaterial = new THREE.MeshStandardMaterial({
        color: 0x2a3a34, roughness: 0.4, metalness: 0.2,
        emissive: 0x2f9c6a, emissiveIntensity: 1.5,
      });
    }
    return this._itemMaterial;
  }

  /**
   * 열쇠 아이템 후광 재질 (KEY_ITEM_GLOW).
   * 텍스처는 64px 캔버스에 그린 방사형 그라디언트 한 장뿐이다 — 파일이 안 늘어난다.
   * 재질을 하나만 만들어 돌려 쓰므로 구역을 다시 로드해도 새지 않는다.
   */
  _glowMat() {
    if (!this._glowMaterial) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const c2 = cv.getContext('2d');
      const grad = c2.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0.00, 'rgba(255,255,255,1)');
      grad.addColorStop(0.22, 'rgba(255,255,255,0.5)');
      grad.addColorStop(1.00, 'rgba(255,255,255,0)');
      c2.fillStyle = grad;
      c2.fillRect(0, 0, 64, 64);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      this._glowMaterial = new THREE.SpriteMaterial({
        map: tex, color: KEY_ITEM_GLOW.color,
        blending: THREE.AdditiveBlending,
        transparent: true, depthWrite: false,
        opacity: KEY_ITEM_GLOW.opacity,
      });
    }
    return this._glowMaterial;
  }

  /**
   * 수색으로 나온 물건을 실제 오브젝트로 꺼내 놓는다.
   * 텍스트만 띄우면 "숫자가 올랐다" 로 끝나지만, 눈앞에 놓이면 집는 행위가 남는다.
   */
  _dropPickup(kind, x, z) {
    const isBattery = kind === 'battery';
    const isAmmo = kind === 'ammo';
    // 모양으로 구분된다 — 배터리는 세로로 선 각기둥, 탄약은 납작한 상자, 붕대는 원통
    const geo = isBattery
      ? new THREE.BoxGeometry(0.05, 0.11, 0.05)
      : isAmmo
        ? new THREE.BoxGeometry(0.11, 0.06, 0.07)
        : new THREE.CylinderGeometry(0.045, 0.045, 0.055, 8);
    const m = new THREE.Mesh(geo, this._itemMat());
    m.position.set(x + (this.scatter.rng() - 0.5) * 0.3, 0.92, z + (this.scatter.rng() - 0.5) * 0.3);
    m.rotation.set(0.3, this.scatter.rng() * 6.28, 0.25);
    this.group.add(m);

    this.interaction.add({
      x: m.position.x, z: m.position.z, radius: 1.5, once: true, mesh: m,
      prompt: () => (isBattery ? '[E]  배터리 줍기' : isAmmo ? '[E]  9mm 탄약 줍기' : '[E]  붕대 줍기'),
      onUse: ({ player, flashlight, weapons }) => {
        if (isBattery) {
          flashlight.addBattery(LOOT.battery.amount);
          return `배터리  +${LOOT.battery.amount}`;
        }
        if (isAmmo) {
          weapons.addAmmo(LOOT.ammo.weaponId, LOOT.ammo.amount);
          return `9mm  +${LOOT.ammo.amount}`;
        }
        player.heal(LOOT.bandage.heal);
        return `붕대  +${LOOT.bandage.heal}`;
      },
    });
  }

  /**
   * 전리품 한 개를 뽑는다 — **독립 확률이 아니라 섞은 자루에서 꺼낸다.**
   *
   * 매번 따로 굴리면 "붕대 9개 · 배터리 0개" 같은 판이 실제로 나온다.
   * 손전등이 핵심 자원인데 한 구역에서 배터리가 하나도 안 나오면 게임이 망가진다.
   * 자루를 가중치대로 채워 섞어 두고 순서대로 꺼내면, **자리는 매 판 달라지지만
   * 무엇이 몇 개 나오는지는 흔들리지 않는다.** 랜덤이 주는 재미만 가져오고 사고는 막는다.
   */
  _drawLoot() {
    if (!this._lootBag?.length) {
      const bag = [];
      // 가중치를 8로 나눠 개수로 바꾼다 (40/18/26/30 → 5/2/3/4, 자루 하나에 14개)
      for (const kind of ['battery', 'bandage', 'ammo', 'empty']) {
        const n = Math.max(1, Math.round((LOOT[kind]?.weight ?? 0) / 8));
        for (let i = 0; i < n; i++) bag.push(kind);
      }
      // 피셔–예이츠. scatter.rng 를 쓰므로 시드를 고정하면 그대로 재현된다
      for (let i = bag.length - 1; i > 0; i--) {
        const j = (this.scatter.rng() * (i + 1)) | 0;
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      this._lootBag = bag;
    }
    return this._lootBag.pop();
  }

  /**
   * 바닥에 놓인 무기. 주우면 인벤토리에 들어간다.
   * weapons.js 에 8종이 정의돼 있는데 시작 2종 말고는 얻을 방법이 없었다 —
   * 정의만 있고 게임에 없으면 없는 것이다. 구역을 넘을 때마다 손에 쥔 것이 달라져야
   * 앞으로 나아가는 맛이 난다.
   */
  _weaponPickup(x, z, id, label) {
    const geo = new THREE.BoxGeometry(0.09, 0.09, 0.62);
    const m = new THREE.Mesh(geo, this._itemMat());
    m.position.set(x, 0.14, z);
    m.rotation.set(0, this.scatter.rng() * 6.28, Math.PI / 2 * 0.06);
    this.group.add(m);

    this.interaction.add({
      x, z, radius: 1.6, once: true, mesh: m,
      prompt: () => `[E]  ${label} 줍기`,
      onUse: ({ weapons }) => {
        if (!weapons.pickUp(id)) return null;
        /**
         * 던지는 무기는 **주운 것만으로는 용도를 모른다.** 근접·총기는 쓰면 바로
         * 알지만, 라디오는 던져도 눈에 보이는 일이 안 일어난다(소리로 끌어모은다).
         * 실제로 "라디오 역할이 뭔지 모르겠다"는 보고가 나왔다 — 그래서 획득 안내와
         * **따로**, 조금 더 길게 설명을 한 번 띄운다. 문구는 config/weapons.js 에 있다.
         */
        const usage = WEAPONS[id]?.usage;
        if (usage) bus.emit(EV.HINT, { text: `${label} — ${usage}`, duration: 6 });
        return `${label} 획득`;
      },
    });
  }

  /**
   * B1 발전기를 살렸는가. **구역을 넘어 남는 유일한 상태**다.
   * 새 판을 시작하면 Game.restart 가 되돌린다.
   */
  get powerRestored() { return this._power ?? false; }
  set powerRestored(v) { this._power = !!v; }

  /**
   * 등록된 비상등 전부의 모드·밝기를 바꾼다.
   * **광원을 새로 만들거나 지우지 않는다** — 개수가 바뀌면 씬 전체가 재컴파일된다
   * (fx/Atmosphere.js 의 고정 슬롯 구조).
   */
  _setLights(mode, scale = 1) {
    for (const e of this.atmosphere.emergencyLights) {
      e.mode = mode; e.base = e.base * scale; e.value = 1;
    }
  }

  /** 소품은 벽과 같은 맵을 쓰고 색만 다르게 — 재질이 늘어나도 텍스처는 안 늘어난다 */
  _propMat(color) {
    if (!this.propMats.has(color)) {
      this.propMats.set(color, makeMat(this.tex.wall, color, SURFACE.propNormalScale));
    }
    return this.propMats.get(color);
  }

  unload() {
    // 구역이 걸어 둔 타이머를 먼저 끊는다. 안 그러면 죽거나 다음 구역으로 넘어간 뒤에도
    // 옥상 카운트다운이 계속 돌면서 엉뚱한 곳에 웨이브를 부른다.
    if (this._onUnload) { this._onUnload(); this._onUnload = null; }
    this.killMarks?.clear();      // 씬에 붙어 있으므로 구역과 같이 안 사라진다
    if (this.group) {
      this.scene.remove(this.group);
      this.group.traverse((o) => {
        if (o.isMesh && !o.geometry.userData.shared) o.geometry.dispose();
      });
      this.group = null;
    }
    this.collision.clear();
    this.atmosphere.clearLights();
    this.spawnPoints = [];
    this.exit = null;
  }

  /** @param {{meta:object, build:Function}} stage */
  load(stage) {
    this.unload();
    this.group = new THREE.Group();
    this.scene.add(this.group);

    // 재질별 지오메트리 모음. 구역을 다 짓고 나서 한 번에 합친다.
    const buckets = new Map();
    const bucket = (key, mat) => {
      let b = buckets.get(key);
      if (!b) { b = { mat: mat ?? this.mat[key], geos: [] }; buckets.set(key, b); }
      return b.geos;
    };

    const ctx = {
      /**
       * 벽 — 충돌 등록됨.
       * 메시를 바로 만들지 않고 지오메트리만 모아둔다. 같은 재질끼리 합쳐야
       * 드로우콜이 벽 개수만큼 늘어나지 않는다 (그림자 패스에서 한 번 더 그려진다).
       */
      addWall: (cx, cz, w, d) => {
        const g = fitBoxUV(new THREE.BoxGeometry(w, WALL_H, d), w, WALL_H, d, SURFACE.wallTile);
        g.translate(cx, WALL_H / 2, cz);
        bucket('wall').push(g);
        this.collision.addBox(cx, cz, w, d);
      },
      addFloor: (cx, cz, w, d) => {
        const g = fitPlaneUV(new THREE.PlaneGeometry(w, d), w, d, SURFACE.floorTile);
        g.rotateX(-Math.PI / 2); g.translate(cx, 0, cz);
        bucket('floor').push(g);
      },
      addCeiling: (cx, cz, w, d) => {
        const g = fitPlaneUV(new THREE.PlaneGeometry(w, d), w, d, SURFACE.ceilingTile);
        g.rotateX(Math.PI / 2); g.translate(cx, WALL_H, cz);
        bucket('ceiling').push(g);
      },
      /**
       * 방 하나 — 바닥 + 천장 + 벽 네 장을 한 번에.
       *
       * 구역 파일마다 계단실·병실을 만들 때 같은 다섯 줄을 반복해서 쓰고 있었다.
       * `open` 에 트인 면을 적어 그쪽 벽을 뺀다 ('n' = -Z, 's' = +Z, 'w' = -X, 'e' = +X).
       *   room(0, 6, 9, 8, { open: 's' })        // 남쪽이 복도로 트인 계단실
       *   room(cx, cz, w, 7, { open: 'we' })     // 좌우가 트인 통과 칸
       * `t` 는 벽 두께 (기본 0.2). 벽을 뺀 면은 충돌도 안 생긴다.
       */
      room: (cx, cz, w, d, { open = '', t = 0.2 } = {}) => {
        ctx.addFloor(cx, cz, w, d);
        ctx.addCeiling(cx, cz, w, d);
        if (!open.includes('w')) ctx.addWall(cx - w / 2, cz, t, d);
        if (!open.includes('e')) ctx.addWall(cx + w / 2, cz, t, d);
        if (!open.includes('n')) ctx.addWall(cx, cz - d / 2, w, t);
        if (!open.includes('s')) ctx.addWall(cx, cz + d / 2, w, t);
      },

      /**
       * 문 구멍이 뚫린 직선 벽 — 한 줄로.
       *
       * 이중 루프로 직접 쓰던 것이다(구역 B·C 에 같은 모양이 있었다).
       * 축을 따라 z0 → z1 로 가면서 `doors` 위치마다 폭 `gap` 만큼 비운다.
       *   wallWithDoors('z', -2.5, 4, 30, [10, 22])   // x=-2.5 벽, z=10·22 에 문
       *   wallWithDoors('x', 3, -8, 8, [0])           // z=3 벽, x=0 에 문
       * 남는 조각이 1cm 미만이면 만들지 않는다 — 그런 벽은 보이지도 않으면서
       * 충돌 박스만 하나 더 만든다.
       */
      wallWithDoors: (axis, fixed, a0, a1, doors = [], { gap = 1.6, t = 0.2 } = {}) => {
        const put = (mid, len) => {
          if (len <= 0.01) return;
          if (axis === 'z') ctx.addWall(fixed, mid, t, len);
          else ctx.addWall(mid, fixed, len, t);
        };
        let cur = a0;
        for (const d of [...doors].sort((p, q) => p - q)) {
          put(cur + (d - gap / 2 - cur) / 2, d - gap / 2 - cur);
          cur = d + gap / 2;
        }
        put(cur + (a1 - cur) / 2, a1 - cur);
      },

      /** 소품 — 충돌 등록됨 (h 는 높이) */
      addProp: (cx, cz, w, h, d, color) => {
        const g = fitBoxUV(new THREE.BoxGeometry(w, h, d), w, h, d, SURFACE.propTile);
        g.translate(cx, h / 2, cz);
        bucket(`prop_${color}`, this._propMat(color)).push(g);
        this.collision.addBox(cx, cz, w, d);
      },
      addLight: (x, y, z, mode, color) => this.atmosphere.addEmergencyLight(x, y, z, mode, color),
      addSpawn: (x, z) => this.spawnPoints.push({ x, z }),

      /** 바닥 핏자국 (kind: 'pool' | 'splatter' | 'drag', 생략하면 무작위) */
      addBlood: (x, z, size, kind, y) => this.scatter.addFloorBlood(this.group, x, z, size, kind, y),
      /** 벽 핏자국 — yaw 는 벽이 바라보는 방향 */
      addWallBlood: (x, y, z, yaw, size, kind) => this.scatter.addWallBlood(this.group, x, y, z, yaw, size, kind),
      /**
       * 절차적 소품 배치 (world/Props.js).
       * @param kind BUILDERS 키 · @param yaw 라디안 · opts.args 빌더 인자 ·
       *        opts.y 높이 · opts.collide [w,d] 충돌 박스
       */
      addProp3D: (kind, x, z, yaw = 0, opts = {}) => {
        // Sketchfab GLB 가 있으면 그쪽이 이긴다. 스테이지 파일은 고치지 않는다.
        // (기울어진 배치 opts.roll/pitch 는 절차적 전용이라 GLB 를 건너뛴다)
        if (!opts.roll && !opts.pitch && !opts.forceProc) {
          const file = pickFile(kind, opts.args);
          if (file && propModels.place(file, x, opts.y ?? 0, z, yaw)) {
            if (opts.collide) this.collision.addBox(x, z, opts.collide[0], opts.collide[1]);
            return;
          }
        }
        const build = BUILDERS[kind];
        if (!build) { console.warn('[stage] 없는 소품:', kind); return; }
        // 충돌 박스 높이는 **만든 지오메트리에서 그대로 잰다.** 손으로 적으면
        // 넘어뜨리거나 크기를 바꿀 때 같이 안 고쳐진다.
        let topY = 0;
        for (const { mat, geo } of build(...(opts.args ?? []))) {
          fitGenericUV(geo, SURFACE.propTile);        // 회전 전에 — 로컬 크기 기준
          if (opts.roll) geo.rotateZ(opts.roll);      // 넘어짐·기울어짐
          if (opts.pitch) geo.rotateX(opts.pitch);
          if (yaw) geo.rotateY(yaw);
          geo.translate(x, opts.y ?? 0, z);
          geo.computeBoundingBox();
          if (geo.boundingBox.max.y > topY) topY = geo.boundingBox.max.y;
          bucket(mat).push(geo);
        }
        /**
         * @param opts.collideAt [dx, dz] 충돌 박스를 소품 좌표에서 이만큼 옮긴다.
         *
         * **넘어뜨린 소품에 필요하다.** `roll` 은 원점을 기준으로 돌리므로, 세워져
         * 있던 물건을 눕히면 무게중심이 옆으로 밀린다 (자판기 h=1.85 를 눕히면
         * 0.925m). 박스는 소품 좌표에 중심을 잡으니 그대로 두면 **보이는 곳과
         * 막히는 곳이 어긋난다** — 허공에서 막히고 물체는 통과된다.
         */
        if (opts.collide) {
          const [dx, dz] = opts.collideAt ?? [0, 0];
          this.collision.addBox(x + dx, z + dz, opts.collide[0], opts.collide[1],
            opts.collideH ?? topY);
        }
      },

      /**
       * GLB 소품을 이름으로 직접 배치 (PropModels.EXTRA_GLB — 절차적 대응이 없는 것).
       * 원점이 바닥 중앙이라 y 를 안 주면 바닥에 놓인다.
       * @param opts.y 높이 · opts.collide [w,d] 충돌 박스
       */
      addPropGLB: (name, x, z, yaw = 0, opts = {}) => {
        if (!propModels.place(name, x, opts.y ?? 0, z, yaw)) {
          console.warn('[stage] 없는 GLB 소품:', name); return;
        }
        // 절차적 소품과 같다 — GLB 의 실제 윗면 높이를 충돌 박스에 넘긴다.
        // 그래야 벤치·양동이 위로 지나는 총알이 통과한다.
        const topY = (opts.y ?? 0) + propModels.topY(name);
        if (opts.collide) {
          this.collision.addBox(x, z, opts.collide[0], opts.collide[1],
            opts.collideH ?? topY);
        }
      },

      /**
       * 뒤질 수 있는 수납가구. 아포칼립스의 기본 루프 —
       * 배터리를 찾으려면 어두운 방으로 들어가야 하고, 뒤지는 소리가 좀비를 부른다.
       * 결과는 고정 시드라 매 판 같다 (레벨이 흔들리면 안 된다).
       */
      /** 바닥에 놓인 무기. id 는 config/weapons.js 의 키 */
      addWeapon: (x, z, id, label) => this._weaponPickup(x, z, id, label),

      addSearchable: (x, z, label = '수납장') => {
        const kind = this._drawLoot();
        this.interaction.add({
          x, z, radius: 1.7, once: true, noisy: true,
          prompt: () => `[E]  ${label} 뒤지기`,
          onUse: () => {
            if (kind === 'empty') return '비어 있다';
            // 알림만 띄우지 않는다. 찾은 물건을 실제로 꺼내 놓고 직접 집게 한다.
            this._dropPickup(kind, x, z);
            // 탄약을 빠뜨리면 "붕대가 나왔다"로 떨어져서, 나온 물건과 안내가 어긋난다
            return kind === 'battery' ? '배터리가 나왔다'
              : kind === 'ammo' ? '9mm 탄약이 나왔다' : '붕대가 나왔다';
          },
        });
      },

      /**
       * 레버 — 올리면 큰 소음이 나고 콜백이 불린다 (발전기 복구용).
       * onPull 은 몇 번째인지(1부터)를 받는다.
       */
      /** @param verb 프롬프트 동사. 레버가 아닌 것(신호탄 등)에 쓴다 */
      addLever: (x, z, yaw, label, onPull, verb = '올리기') => {
        const pulled = { done: false };
        for (const { mat, geo } of BUILDERS.lever()) {
          fitGenericUV(geo, SURFACE.propTile);
          if (yaw) geo.rotateY(yaw);
          geo.translate(x, 0, z);
          bucket(mat).push(geo);
        }
        this.interaction.add({
          x, z, radius: 2.0, once: true, noisy: true,
          // **이 구역을 진행시키는 것이 무엇인지 표시해 둔다.** 다섯 구역의 사건이
          // 전부 레버다 — B1 발전기 3 · 2F 무전기 4 · 3F 무영등 2 · 옥상 신호탄 1.
          // 관리자 모드의 "사건 즉시 해결"(Alt+K)이 이 표시만 보고 찾는다. 수납장·문도
          // noisy 라서 그걸로 고르면 온 층의 서랍이 다 열린다.
          event: true,
          prompt: () => `[E]  ${label} ${verb}`,
          onUse: () => { pulled.done = true; return onPull?.() ?? `${label} 작동`; },
        });
      },
      /** 이벤트용 강제 웨이브 */
      triggerWave: (count, type) => this.director?.triggerWave(count, type),
      /**
       * 탈출 지점을 나중에 여는 용도. build() 가 exit 를 안 돌려주면 그 구역은
       * 출구가 없는 상태로 시작하고, 사건이 끝난 뒤 이걸로 연다 (옥상 신호탄).
       * null 을 주면 다시 닫는다.
       */
      setExit: (exit) => { this.exit = exit; },
      /** 구역 분위기 전환 (전원 복구 등) */
      setMood: (mood) => this.atmosphere.applyStageMood(mood),
      /** 등록된 비상등 전부의 모드·밝기를 바꾼다 */
      setLights: (mode, scale = 1) => this._setLights(mode, scale),

      /** 명패·포스터·표지. slot 은 아틀라스 칸 번호 (0~15), glow 면 자체발광 */
      /**
       * @param roll  판을 화면 안에서 기울인다 — 한쪽 줄이 끊겨 매달린 표지판
       * @param pitch 판을 앞뒤로 눕힌다 — 바닥에 떨어진 조각(-Math.PI/2 면 완전히 눕는다)
       */
      addSign: (slot, x, y, z, yaw, w, h, glow = false, roll = 0, pitch = 0) => {
        const col = slot % SIGN_COLS, row = Math.floor(slot / SIGN_COLS);
        for (const { geo } of signPlate(w, h, col, row, SIGN_COLS, SIGN_ROWS)) {
          if (roll) geo.rotateZ(roll);
          if (pitch) geo.rotateX(pitch);
          geo.rotateY(yaw);
          geo.translate(x, y, z);
          bucket(glow ? 'plateGlow' : 'plate').push(geo);
        }
      },

      /** 의료폐기물 산포 — 직사각 구역에 뿌린다 */
      scatterDebris: (cx, cz, w, d, density) => this.scatter.scatterDebris(cx, cz, w, d, density),

      /** 주울 수 있는 아이템. id 는 player.items 에 들어간다 */
      addItem: (x, z, id, label, y = 0.95) => {
        const g = new THREE.BoxGeometry(0.085, 0.005, 0.054);
        const m = new THREE.Mesh(g, this._itemMat());
        m.position.set(x, y, z);
        m.rotation.set(0.1, Math.random() * Math.PI, 0.06);
        // 후광은 카드의 **자식**이다 — 주우면 카드와 함께 사라진다(따로 지울 필요가 없다)
        const glow = new THREE.Sprite(this._glowMat());
        glow.scale.setScalar(KEY_ITEM_GLOW.size);
        glow.position.set(0, KEY_ITEM_GLOW.y, 0);
        glow.onBeforeRender = () => {
          const t = performance.now() / 1000;
          glow.material.opacity = KEY_ITEM_GLOW.opacity
            + Math.sin(t * KEY_ITEM_GLOW.pulseHz * Math.PI * 2) * KEY_ITEM_GLOW.pulse;
        };
        m.add(glow);
        this.group.add(m);
        this.interaction.add({
          x, z, radius: 1.9, once: true, mesh: m,
          prompt: () => `[E]  ${label} 줍기`,
          onUse: ({ player }) => { player.items.add(id); return `${label} 획득`; },
        });
      },

      /**
       * 잠긴 문. 열리면 충돌이 꺼지고 문이 옆으로 미끄러진다.
       * @param requires 아이템 id(문자열) 또는 조건 함수 — 진행도로 열리는 문에 쓴다
       * @param lockedMsg 잠겼을 때 보여줄 이유. 생략하면 카드키 문구
       */
      addDoor: (cx, cz, w, d, requires, label, lockedMsg = '카드키가 필요하다') => {
        const canOpen = typeof requires === 'function'
          ? () => requires()
          : ({ player }) => player.items.has(requires);
        const g = fitBoxUV(new THREE.BoxGeometry(w, WALL_H, d), w, WALL_H, d, SURFACE.wallTile);
        const m = new THREE.Mesh(g, this._propMat(0x4b5250));
        m.position.set(cx, WALL_H / 2, cz);
        m.castShadow = true; m.receiveShadow = true;
        this.group.add(m);
        const box = this.collision.addBox(cx, cz, w, d);

        this.interaction.add({
          x: cx, z: cz, radius: 2.3, once: true, noisy: true,
          prompt: (arg) => (canOpen(arg)
            ? `[E]  ${label} 열기`
            : `${label} — 잠김. ${lockedMsg}`),
          onUse: (arg) => {
            if (!canOpen(arg)) return { msg: lockedMsg, done: false };
            box.enabled = false;
            this.interaction.slide(m, w * 0.94, 0);
            return `${label} 개방`;
          },
        });
      },
    };

    // 판마다 전리품·잔해 자리를 섞는다. 구역마다 시드를 달리해야 5개 구역이
    // 똑같이 흔들리지 않는다 — 같은 시드를 쓰면 층만 바뀌고 배치 패턴은 똑같아진다.
    this.lastSeed = SCATTER.forceSeed ?? (SCATTER.randomPerRun
      ? ((Math.random() * 0xffffffff) >>> 0)
      : SCATTER.seed);
    this.scatter.reset((this.lastSeed + (stage.meta?.id?.length ?? 0) * 2654435761) >>> 0);
    this._lootBag = null;   // 구역마다 자루를 새로 채운다
    this.interaction.reset();
    propModels.reset();
    // 바닥 재질 질의 — 발소리가 이걸 본다. 스테이지가 정의하지 않으면 콘크리트
    this.surfaceAt = stage.surfaceAt ?? (() => 'concrete');
    const result = stage.build(ctx) ?? {};

    // ── 병합 ── 벽 126개가 각각 드로우콜이면 그림자 패스까지 252개가 된다
    for (const [key, b] of buckets) {
      if (!b.geos.length) continue;
      const merged = mergeGeometries(b.geos, false);
      for (const g of b.geos) g.dispose();
      if (!merged) { console.warn('[stage] 병합 실패:', key); continue; }
      const m = new THREE.Mesh(merged, b.mat);
      // 천장과 반투명(유리·커튼·표지)은 그림자를 만들지 않는다 — 예산이자 시각적으로도 틀리다
      m.castShadow = key !== 'ceiling' && !b.mat.transparent;
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;         // 정적 지오메트리 — 매 프레임 행렬 갱신 불필요
      if (b.mat.transparent) m.renderOrder = 2;
      this.group.add(m);
    }

    // GLB 소품은 병합 대상이 아니다(재질이 제각각). 대신 같은 소품끼리 인스턴싱으로 묶는다.
    propModels.flush(this.group);

    this.scatter.finalize(this.group);
    /**
     * **B1 에서 발전기를 살렸으면 위층도 그 상태로 시작한다.**
     *
     * 예전에는 구역마다 자기 `mood` 만 적용해서, 지하에서 전원을 복구하고 올라가면
     * 2F 가 다시 칠흑이었다 — 플레이어에게는 방금 한 일이 없던 일이 된다.
     * 그렇다고 B1 만큼(앰비언트 1.15) 밝히면 손전등이 필요 없어져 게임이 무너지므로,
     * 구역이 직접 정한 `poweredMood` 로 **조금만** 올린다.
     */
    const powered = this.powerRestored ? stage.meta.poweredMood : null;
    this.atmosphere.applyStageMood({ ...(stage.meta.mood ?? {}), ...(powered ?? {}) });
    if (powered && stage.meta.poweredBoost) {
      // **모드는 건드리지 않는다.** 등마다 steady·flicker·pulse 를 따로 정해 둔 것이
      // 그 층의 인상이다 — 전부 flicker 로 덮으면 전기가 온 게 아니라 조명이
      // 고장 난 것처럼 보인다. 전기가 왔다는 것은 **밝기**로만 말한다.
      for (const e of this.atmosphere.emergencyLights) e.base *= stage.meta.poweredBoost;
    }
    this.director?.setStage(this.spawnPoints, stage.meta.typeWeights);
    // exit 가 없는 구역도 있다 — 사건이 끝나야 열린다 (옥상). ctx.setExit 으로 연다.
    this.exit = result.exit ?? null;
    // 사건이 끝나야 열리는 구역은 "열릴 예정인 출구"를 따로 알려준다.
    // 검사 도구가 목표 지점을 알 수 있어야 경로를 확인할 수 있다.
    this.exitPending = result.exitWhenReady ?? null;
    this._onUnload = result.onUnload ?? null;

    // **구역이 다 지어진 지금 알린다.** 이 이벤트는 EventBus 에 정의돼 있고 Game 이
    // 구독까지 해 두었는데(전투 핏자국 지우기) **발행하는 코드가 어디에도 없었다** —
    // 구독만 있는 죽은 이벤트라 구역을 넘어가도 앞 구역의 핏자국이 그대로 따라왔다.
    // load() 안에서 쏘는 이유: 호출자가 셋(startAttract·restart·_nextStage)이라
    // 바깥에서 쏘면 한 곳을 빠뜨린다.
    bus.emit(EV.STAGE_LOADED, { name: stage.meta?.name ?? '' });

    return result.playerStart ?? { x: 0, z: 0, yaw: 0 };
  }
}
