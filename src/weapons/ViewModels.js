import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * GLB 무기 — 절차적 모델보다 나은 것만 쓴다. 나머지는 아래 절차적 빌더가 담당한다.
 *   axe               : Kenney Survival Kit (CC0)
 *   pipe·pistol·crowbar : Sketchfab (CC BY 4.0 — 크레딧은 ASSETS.md §4-B)
 * Sketchfab 3종은 tools/import_props.py 가 실물 크기·중심 원점으로 맞춰 놨다.
 * 손에 드는 각도는 config/balance.js 의 WEAPON_VIEW 에서 조절한다.
 */
const GLB_DIR = `${import.meta.env.BASE_URL}assets/models/weapons/`;
const GLB_WEAPONS = {
  axe: 'weapon_axe',
  pipe: 'weapon_pipe', pistol: 'weapon_pistol', crowbar: 'weapon_crowbar',
};
const _glb = {};

/** 게임 시작 전에 부른다. 실패해도 절차적 모델로 대체된다 */
export function preloadWeaponModels() {
  const loader = new GLTFLoader();
  return Promise.all(Object.entries(GLB_WEAPONS).map(([id, file]) =>
    loader.loadAsync(`${GLB_DIR}${file}.glb`)
      .then((g) => { _glb[id] = g.scene; })
      .catch((e) => console.warn(`[weapon] ${file} 로드 실패 — 절차적 모델로 대체`, e))
  ));
}

/** 로드된 GLB 사본. 없으면 null */
export function cloneWeaponGLB(id) {
  return _glb[id] ? _glb[id].clone(true) : null;
}

/**
 * ViewModels — 1인칭 무기 뷰모델 지오메트리 (절차적).
 *
 * 좌표계: 원점이 그립(손). 총구·날 끝은 **-Z 방향**으로 뻗는다.
 * WeaponSystem 의 viewRoot 가 카메라 자식이라 그대로 손에 든 것처럼 보인다.
 *
 * 각 빌더는 `[{ mat, geo }, ...]` — 재질별로 묶어 메시 몇 개로 만든다.
 * 뷰모델은 손전등(26cd) 코앞 0.45m 라 재질을 어둡게 눌러 쓴다 (SURFACE.viewModelDim).
 *
 * 재질 키: steel(광택 금속) · dark(무광 검정) · grip(고무/천) · accent(색) · glass
 */

const box = (w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
};
/** 기본은 -Z 로 눕힌 원통 (총열·파이프) */
const rod = (r, len, x = 0, y = 0, z = 0, seg = 8) => {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
};
const P = (mat, geo) => ({ mat, geo });

/** 쇠파이프 — 끝이 찌그러지고 테이프를 감았다 */
export function pipe() {
  return [
    P('steel', rod(0.019, 0.86, 0, 0, -0.40, 10)),
    P('steel', box(0.05, 0.05, 0.07, 0, 0, -0.82, 0, 0, 0.3)),   // 찌그러진 끝
    P('grip', rod(0.024, 0.15, 0, 0, -0.06, 10)),                 // 테이프 감은 그립
    P('grip', rod(0.023, 0.05, 0, 0, -0.19, 8)),
  ];
}

/** 소방도끼 */
export function axe() {
  return [
    P('grip', rod(0.018, 0.72, 0, 0, -0.34, 8)),
    P('grip', rod(0.022, 0.13, 0, 0, -0.05, 8)),
    P('accent', box(0.028, 0.14, 0.11, 0, 0.02, -0.66)),          // 도끼날 몸통
    P('steel', box(0.012, 0.17, 0.05, 0, 0.02, -0.72)),           // 날
    P('accent', box(0.026, 0.05, 0.09, 0, -0.05, -0.63, 0, 0, 0.5)), // 뒷날(피크)
  ];
}

/** 소화기 — 던지거나 휘두른다 */
export function extinguisher() {
  return [
    P('accent', rod(0.062, 0.34, 0, -0.02, -0.24, 12)),
    P('dark', rod(0.026, 0.08, 0, -0.02, -0.44, 8)),
    P('steel', box(0.09, 0.03, 0.03, 0, 0.03, -0.46)),            // 손잡이
    P('dark', rod(0.014, 0.16, 0.02, -0.04, -0.5, 6)),            // 호스
    P('grip', box(0.1, 0.05, 0.07, 0, -0.02, -0.06)),
  ];
}

/** 수술용 절단기 — 짧고 빠르다 */
export function bonesaw() {
  return [
    P('grip', box(0.032, 0.05, 0.12, 0, -0.01, -0.06)),
    P('steel', box(0.01, 0.055, 0.26, 0, 0.01, -0.24)),
    P('steel', box(0.014, 0.02, 0.05, 0, 0.035, -0.36, 0, 0, 0.25)),
    P('dark', box(0.036, 0.02, 0.04, 0, -0.035, -0.1)),            // 트리거
  ];
}

/** 9mm 권총 */
export function pistol() {
  return [
    P('dark', box(0.032, 0.05, 0.19, 0, 0.02, -0.10)),             // 슬라이드
    P('steel', box(0.026, 0.026, 0.16, 0, -0.018, -0.09)),         // 프레임
    P('dark', rod(0.007, 0.02, 0, 0.02, -0.20, 6)),                // 총구
    P('grip', box(0.03, 0.11, 0.045, 0, -0.085, -0.005, 0.28)),    // 그립
    P('dark', box(0.02, 0.028, 0.012, 0, -0.05, -0.045)),          // 트리거 가드
    P('steel', box(0.006, 0.012, 0.008, 0, 0.05, -0.185)),         // 가늠쇠
  ];
}

/** 산탄총 — 길고 무겁다 */
export function shotgun() {
  return [
    P('steel', rod(0.016, 0.62, 0, 0.015, -0.42, 10)),             // 총열
    P('steel', rod(0.013, 0.56, 0, -0.012, -0.40, 8)),             // 탄창관
    P('dark', box(0.042, 0.06, 0.2, 0, 0.005, -0.16)),             // 기관부
    P('grip', box(0.036, 0.05, 0.14, 0, -0.008, -0.36)),           // 펌프
    P('grip', box(0.034, 0.075, 0.16, 0, -0.045, 0.03, -0.18)),    // 개머리판
    P('dark', box(0.018, 0.026, 0.012, 0, -0.035, -0.09)),
  ];
}

/** 못총 — 조용한 총 */
export function nailgun() {
  return [
    P('accent', box(0.05, 0.09, 0.17, 0, 0.02, -0.09)),            // 본체
    P('dark', box(0.024, 0.024, 0.07, 0, -0.005, -0.2)),           // 노즈
    P('grip', box(0.036, 0.1, 0.05, 0, -0.075, -0.01, 0.22)),
    P('dark', box(0.03, 0.07, 0.11, 0.03, 0.03, -0.03, 0, 0, -0.5)), // 못 탄창
    P('steel', rod(0.005, 0.03, 0, -0.005, -0.24, 5)),
  ];
}

/**
 * 화염병 — 유리병 · 안에 든 기름 · 목에 감은 천 · 타고 있는 심지.
 * 심지는 `flame` 재질이라 손전등을 꺼도 혼자 빛난다.
 */
export function molotov() {
  return [
    P('glass', rod(0.045, 0.20, 0, 0, -0.14, 10)),                // 병 몸통
    P('accent', rod(0.038, 0.15, 0, 0, -0.13, 8)),                // 안에 든 기름
    P('glass', rod(0.021, 0.08, 0, 0, -0.28, 8)),                 // 병목
    P('grip', rod(0.026, 0.06, 0, 0, -0.31, 7)),                  // 감아 놓은 천
    P('flame', box(0.03, 0.045, 0.03, 0, 0.012, -0.355)),         // 타고 있는 심지
  ];
}

/** 라디오 — 소리로 유인한다 */
export function radio() {
  return [
    P('dark', box(0.13, 0.085, 0.05, 0, 0, -0.08)),
    P('steel', rod(0.004, 0.16, 0.05, 0.06, -0.07, 5)),            // 안테나
    P('accent', box(0.03, 0.03, 0.006, -0.035, 0.005, -0.106)),    // 다이얼
    P('grip', box(0.05, 0.045, 0.006, 0.025, 0.005, -0.106)),      // 스피커 그릴
  ];
}

/** 지렛대 */
export function crowbar() {
  return [
    P('steel', rod(0.014, 0.62, 0, 0, -0.32, 8)),
    P('steel', box(0.026, 0.026, 0.11, 0.02, 0.03, -0.62, 0.6)),   // 굽은 끝
    P('steel', box(0.02, 0.05, 0.03, 0, -0.01, -0.03, 0, 0, 0.4)),
  ];
}

/** 무기 id → 빌더. 없으면 WeaponSystem 이 박스로 대체한다 */
export const WEAPON_MODELS = {
  pipe, axe, extinguisher, bonesaw, pistol, shotgun, nailgun, radio, crowbar, molotov,
};
