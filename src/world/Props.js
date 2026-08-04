import * as THREE from 'three';

/**
 * Props — 절차적 소품 지오메트리.
 *
 * 각 빌더는 `[{ mat, geo }, ...]` 를 돌려준다. StageLoader 가 재질별 버킷에 넣어
 * 한 번에 병합하므로, 소품을 50개 놓아도 드로우콜은 재질 종류만큼만 는다.
 * 좌표계: 원점이 바닥 중심, +Z 가 정면. 크기 단위는 미터.
 *
 * 재질 키: metal / enamel / fabric / accent / glass / lamp / plate
 */

const box = (w, h, d, x = 0, y = 0, z = 0, ry = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
};

const cyl = (r, h, x = 0, y = 0, z = 0, seg = 8, axis = 'y') => {
  const g = new THREE.CylinderGeometry(r, r, h, seg);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
};

const P = (mat, geo) => ({ mat, geo });

/* ───────────────── Phase 2 · 벽 디테일 ───────────────── */

/** 걸레받이 — 벽 하단 띠. 벽이 평평해 보이지 않게 한다 */
export function baseboard(len, horizontal = true) {
  const g = horizontal ? box(len, 0.11, 0.045, 0, 0.055, 0)
    : box(0.045, 0.11, len, 0, 0.055, 0);
  return [P('accentDark', g)];
}

/** 핸드레일 — 병원 복도의 시그니처. 손전등이 스치면 그림자가 길게 지나간다 */
export function handrail(len, horizontal = true) {
  const parts = [];
  const y = 0.92;
  parts.push(P('metal', horizontal ? cyl(0.028, len, 0, y, 0, 8, 'x')
    : cyl(0.028, len, 0, y, 0, 8, 'z')));
  const n = Math.max(2, Math.round(len / 1.8));
  for (let i = 0; i < n; i++) {
    const t = -len / 2 + (len * (i + 0.5)) / n;
    parts.push(P('metal', horizontal
      ? box(0.05, 0.06, 0.09, t, y, -0.05)
      : box(0.09, 0.06, 0.05, -0.05, y, t)));
  }
  return parts;
}

/** 모서리 보호대 */
export function cornerGuard(h = 1.6) {
  return [P('accentDark', box(0.07, h, 0.07, 0, h / 2, 0, Math.PI / 4))];
}

/** 환기구 그릴 */
export function vent(w = 0.5, h = 0.3) {
  const parts = [P('accentDark', box(w, h, 0.04))];
  const n = 5;
  for (let i = 0; i < n; i++) {
    parts.push(P('metal', box(w - 0.06, 0.018, 0.03, 0, -h / 2 + (h * (i + 0.7)) / n, 0.02)));
  }
  return parts;
}

/* ───────────────── Phase 1 · 문 ───────────────── */

/** 문틀 — 상인방 + 기둥 2 */
export function doorFrame(w = 1.3, h = 2.1, t = 0.28) {
  return [
    P('enamel', box(0.09, h, t, -w / 2, h / 2, 0)),
    P('enamel', box(0.09, h, t, w / 2, h / 2, 0)),
    P('enamel', box(w + 0.18, 0.11, t, 0, h + 0.05, 0)),
  ];
}

/**
 * 문짝 — 창이 뚫린 형태를 4개 프레임 + 유리로 만든다.
 * 경첩이 원점(-w/2)에 오도록 만들어서 StageLoader 가 각도만 주면 열린다.
 */
export function doorPanel(w = 1.25, h = 2.05) {
  const th = 0.05;
  const gw = w * 0.44, gh = h * 0.34;           // 유리창 크기
  const gy = h * 0.66;                           // 유리창 중심 높이
  const side = (w - gw) / 2;
  const parts = [
    P('enamel', box(side, h, th, -(w - side) / 2, h / 2, 0)),
    P('enamel', box(side, h, th, (w - side) / 2, h / 2, 0)),
    P('enamel', box(gw, h - (gy + gh / 2), th, 0, (h + gy + gh / 2) / 2, 0)),
    P('enamel', box(gw, gy - gh / 2, th, 0, (gy - gh / 2) / 2, 0)),
    P('glass', box(gw, gh, 0.012, 0, gy, 0)),
    P('metal', cyl(0.022, 0.13, w / 2 - 0.13, 1.02, th, 6, 'z')),   // 손잡이
  ];
  // 경첩이 회전축이 되도록 전체를 +x 로 민다
  for (const p of parts) p.geo.translate(w / 2, 0, 0);
  return parts;
}

/** 뜯겨나가 바닥에 떨어진 문짝. 경첩이 버티지 못한 흔적 */
export function doorFallen(w = 1.25, h = 2.05) {
  const th = 0.05;
  const parts = [
    P('enamel', box(w, th, h * 0.62, 0, th / 2, -h * 0.19)),
    P('enamel', box(w, th, h * 0.3, 0.06, th / 2 + 0.02, h * 0.3)),   // 두 조각으로 부러짐
    P('glass', box(w * 0.4, 0.012, 0.3, -0.1, th + 0.01, h * 0.12)),
    P('metal', box(0.09, 0.03, 0.12, w / 2 - 0.1, th, -h * 0.42)),    // 떨어져나간 경첩
  ];
  return parts;
}

/** 문틈을 막은 판자 바리케이드 */
export function boardedDoor(w = 1.3) {
  const parts = [];
  const ys = [0.55, 1.15, 1.72];
  for (let i = 0; i < ys.length; i++) {
    const g = new THREE.BoxGeometry(w + 0.25, 0.16, 0.035);
    g.rotateZ((i % 2 ? 1 : -1) * (0.06 + i * 0.02));
    g.translate(0, ys[i], 0);
    parts.push(P('accentDark', g));
  }
  return parts;
}

/* ───────────────── Phase 3 · 소품 ───────────────── */

/**
 * 병상. variant 로 어질러진 정도를 바꾼다 — 열두 개가 전부 반듯하면 폐병원이 아니다.
 * 0 정돈 · 1 이불이 뭉쳐 흘러내림 · 2 매트리스가 어긋남 · 3 매트리스가 바닥으로 떨어짐
 */
export function bed(variant = 0) {
  const w = 0.92, l = 2.0, fy = 0.56;
  const parts = [
    P('enamel', box(w, 0.07, l, 0, fy, 0)),
    P('enamel', box(w, 0.55, 0.06, 0, fy + 0.3, -l / 2)),                // 헤드보드
    P('enamel', box(w, 0.34, 0.06, 0, fy + 0.2, l / 2)),                 // 풋보드
  ];
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    parts.push(P('metal', cyl(0.028, fy, sx * (w / 2 - 0.07), fy / 2, sz * (l / 2 - 0.1), 6)));
  }

  if (variant === 3) {
    // 매트리스가 침대 옆 바닥에 떨어져 있다
    const g = new THREE.BoxGeometry(w - 0.06, 0.13, l - 0.16);
    g.rotateY(0.28); g.rotateZ(0.06); g.translate(w * 0.95, 0.08, -0.15);
    parts.push(P('fabric', g));
    parts.push(P('metal', box(w - 0.1, 0.02, l - 0.2, 0, fy + 0.04, 0)));   // 드러난 스프링 판
    return parts;
  }

  const off = variant === 2 ? 0.18 : 0;
  const rot = variant === 2 ? 0.09 : 0;
  const mat = new THREE.BoxGeometry(w - 0.06, 0.13, l - 0.16);
  if (rot) mat.rotateY(rot);
  mat.translate(off, fy + 0.1, 0);
  parts.push(P('fabric', mat));
  parts.push(P('fabric', box(w - 0.1, 0.06, 0.5, off, fy + 0.19, -l / 2 + 0.35, rot)));  // 베개

  if (variant === 1) {
    // 이불이 발치에 뭉쳐 있고 한쪽이 바닥으로 흘러내린다
    parts.push(P('fabric', box(w - 0.02, 0.22, 0.62, 0, fy + 0.24, l / 2 - 0.55)));
    const drape = new THREE.BoxGeometry(0.34, 0.62, 0.5);
    drape.rotateZ(0.22); drape.translate(w / 2 + 0.06, fy - 0.1, l / 2 - 0.75);
    parts.push(P('fabric', drape));
  }
  return parts;
}

/** 넘어진 링거대 — 바닥에 누워 있다 */
export function ivStandFallen() {
  const parts = [];
  const pole = new THREE.CylinderGeometry(0.018, 0.018, 1.62, 6);
  pole.rotateZ(Math.PI / 2); pole.translate(0, 0.05, 0);
  parts.push(P('metal', pole));
  parts.push(P('metal', cyl(0.15, 0.03, -0.78, 0.05, 0, 10, 'x')));
  parts.push(P('fabric', box(0.14, 0.06, 0.22, 0.6, 0.03, 0.1)));
  return parts;
}

/** 링거대 — 가늘어서 손전등에 실루엣이 잘 잡힌다 */
export function ivStand() {
  const parts = [
    P('metal', cyl(0.018, 1.62, 0, 0.81, 0, 6)),
    P('metal', cyl(0.15, 0.03, 0, 0.02, 0, 10)),
    P('metal', cyl(0.012, 0.26, 0, 1.6, 0.12, 5, 'z')),
    P('fabric', box(0.14, 0.24, 0.05, 0, 1.44, 0.22)),                   // 링거백
    P('glass', cyl(0.004, 0.55, 0, 1.05, 0.22, 4)),                      // 라인
  ];
  return parts;
}

/** 휠체어 */
export function wheelchair() {
  const parts = [
    P('fabric', box(0.46, 0.06, 0.44, 0, 0.5, 0)),
    P('fabric', box(0.46, 0.5, 0.05, 0, 0.75, -0.22)),
    P('metal', box(0.5, 0.04, 0.04, 0, 0.28, 0.2)),                      // 발판
  ];
  for (const sx of [-1, 1]) {
    parts.push(P('metal', cyl(0.29, 0.035, sx * 0.27, 0.29, -0.02, 12, 'x')));
    parts.push(P('metal', cyl(0.08, 0.03, sx * 0.2, 0.08, 0.3, 8, 'x')));
    parts.push(P('metal', box(0.035, 0.62, 0.035, sx * 0.24, 0.62, -0.24)));
  }
  return parts;
}

/** 이동식 카트 */
export function cart() {
  const w = 0.62, d = 0.44;
  const parts = [
    P('metal', box(w, 0.04, d, 0, 0.84, 0)),
    P('metal', box(w - 0.06, 0.03, d - 0.06, 0, 0.5, 0)),
    P('metal', box(w - 0.1, 0.02, d - 0.1, 0, 0.2, 0)),
  ];
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    parts.push(P('metal', cyl(0.014, 0.78, sx * (w / 2 - 0.04), 0.45, sz * (d / 2 - 0.04), 5)));
    parts.push(P('accentDark', cyl(0.045, 0.03, sx * (w / 2 - 0.04), 0.045, sz * (d / 2 - 0.04), 6, 'x')));
  }
  return parts;
}

/** 캐비닛 — 서랍 하나가 빠져나온 모습 */
export function cabinet() {
  const w = 0.72, h = 1.24, d = 0.44;
  const parts = [P('enamel', box(w, h, d, 0, h / 2, 0))];
  for (let i = 0; i < 3; i++) {
    const y = 0.24 + i * 0.36;
    const out = i === 1 ? 0.22 : 0.0;                                    // 가운데만 열림
    parts.push(P('accentDark', box(w - 0.06, 0.3, 0.03, 0, y, d / 2 + 0.01 + out)));
    parts.push(P('metal', box(0.22, 0.025, 0.025, 0, y, d / 2 + 0.03 + out)));
  }
  return parts;
}

/** 소화기 + 벽 거치대 */
export function extinguisher() {
  return [
    P('accent', cyl(0.075, 0.46, 0, 0.25, 0, 10)),
    P('accentDark', cyl(0.03, 0.1, 0, 0.52, 0, 6)),
    P('metal', box(0.16, 0.04, 0.03, 0, 0.55, 0.02)),
    P('accentDark', box(0.2, 0.05, 0.09, 0, 0.16, 0)),
  ];
}

/** 병상 커튼 — 반투명. 시야를 끊어 긴장을 만든다 (SPEC §5) */
export function curtain(w = 1.9, h = 1.95) {
  const parts = [P('metal', cyl(0.014, w, 0, h + 0.06, 0, 6, 'x'))];
  // 주름을 흉내내려고 폭을 몇 조각으로 나눠 살짝씩 어긋나게 세운다
  const n = 6;
  for (let i = 0; i < n; i++) {
    const t = -w / 2 + (w * (i + 0.5)) / n;
    const off = (i % 2 ? 1 : -1) * 0.03;
    parts.push(P('sheer', box(w / n + 0.02, h, 0.012, t, h / 2, off)));
  }
  return parts;
}

/** 떨어진 천장 타일 — 밟으면 부서질 것 같은 조각들 */
export function ceilingTileFallen() {
  const parts = [];
  const specs = [[0.58, 0.5, 0, 0, 0.12], [0.4, 0.34, 0.5, 0.3, -0.5], [0.26, 0.3, -0.45, -0.25, 0.7]];
  for (const [w, d, x, z, r] of specs) {
    const g = new THREE.BoxGeometry(w, 0.016, d);
    g.rotateY(r); g.rotateZ(0.03);
    g.translate(x, 0.012, z);
    parts.push(P('fabric', g));
  }
  return parts;
}

/** 천장이 뚫린 자리 — 어두운 구멍과 늘어진 배선 */
export function ceilingHole() {
  const parts = [P('accentDark', box(1.0, 0.06, 0.9, 0, 0.04, 0))];
  for (let i = 0; i < 4; i++) {
    const a = i * 1.6;
    const g = new THREE.CylinderGeometry(0.008, 0.008, 0.5 + (i % 2) * 0.35, 4);
    g.rotateZ(0.25 + i * 0.08);
    g.translate(Math.cos(a) * 0.24, -0.28 - (i % 2) * 0.16, Math.sin(a) * 0.22);
    parts.push(P('accentDark', g));
  }
  return parts;
}

/** 옆으로 넘어진 이동침대 — 복도를 반쯤 막는다 */
export function gurneyToppled() {
  const w = 0.9, l = 1.95;
  const parts = [
    P('enamel', box(w, 0.07, l, 0, 0.5, 0)),          // 상판이 세로로 서 있다
    P('fabric', box(w - 0.08, 0.12, l - 0.2, 0.12, 0.5, 0)),
    P('enamel', box(w, 0.45, 0.06, 0, 0.72, -l / 2)),
  ];
  for (const sz of [-1, 1]) {
    parts.push(P('metal', cyl(0.024, 0.62, -0.3, 0.2, sz * (l / 2 - 0.15), 6, 'x')));
    parts.push(P('accentDark', cyl(0.055, 0.03, -0.58, 0.2, sz * (l / 2 - 0.15), 6, 'x')));
  }
  const g = mergeAll(parts);
  return g;
}

function mergeAll(parts) {
  // 통째로 90도 눕힌다
  for (const p of parts) { p.geo.rotateZ(Math.PI / 2 - 0.12); p.geo.translate(0, 0.05, 0); }
  return parts;
}

/* ───────────────── Phase 5 · 조명 기구 ───────────────── */

/** 형광등 기구. broken 이면 발광 패널 없이 깨진 유리만 */
export function ceilingLight(broken = false) {
  const parts = [
    P('accentDark', box(1.18, 0.09, 0.26, 0, -0.045, 0)),
    P('metal', box(1.24, 0.03, 0.04, 0, -0.005, 0.14)),
    P('metal', box(1.24, 0.03, 0.04, 0, -0.005, -0.14)),
  ];
  if (broken) {
    parts.push(P('glass', box(0.42, 0.012, 0.2, -0.3, -0.09, 0)));
    parts.push(P('glass', box(0.22, 0.012, 0.16, 0.34, -0.09, 0.02)));
  } else {
    parts.push(P('lamp', box(1.06, 0.02, 0.2, 0, -0.088, 0)));
  }
  return parts;
}

/** 비상등 — 붉은 돔 */
export function emergencyLamp() {
  return [
    P('accentDark', box(0.22, 0.1, 0.12, 0, 0, 0)),
    P('accent', cyl(0.075, 0.09, 0, -0.07, 0, 8)),
  ];
}

/* ───────────── 로비·복도 대형 소품 (박스 대체) ───────────── */

/** 접수 데스크 — 카운터 + 상판 턱 + 측면 패널 */
export function receptionDesk(w = 3.4, d = 1.1) {
  const h = 1.02;
  return [
    P('enamel', box(w, h - 0.06, d - 0.14, 0, (h - 0.06) / 2, -0.05)),
    P('accentDark', box(w + 0.14, 0.07, d, 0, h, 0)),               // 상판
    P('accentDark', box(w + 0.1, 0.16, 0.09, 0, h - 0.26, d / 2)),  // 앞면 몰딩
    P('metal', box(w - 0.4, 0.03, 0.35, 0, h - 0.34, -d / 2 + 0.2)), // 안쪽 선반
    P('enamel', box(0.1, h, d, -w / 2, h / 2, 0)),
    P('enamel', box(0.1, h, d, w / 2, h / 2, 0)),
  ];
}

/** 연결형 대기 의자 — n 칸 */
export function chairRow(n = 3) {
  const sw = 0.52, gap = 0.06, y = 0.44;
  const total = n * sw + (n - 1) * gap;
  const parts = [P('metal', box(0.06, 0.06, total, 0, 0.12, 0))];
  for (let i = 0; i < n; i++) {
    const z = -total / 2 + sw / 2 + i * (sw + gap);
    parts.push(P('fabric', box(0.48, 0.07, sw, 0, y, z)));
    parts.push(P('fabric', box(0.06, 0.42, sw, -0.21, y + 0.24, z)));   // 등받이
    parts.push(P('metal', box(0.05, y, 0.05, 0.16, y / 2, z - sw / 2 + 0.06)));
    parts.push(P('metal', box(0.05, y, 0.05, 0.16, y / 2, z + sw / 2 - 0.06)));
  }
  return parts;
}

/** 정문 바리케이드 — 못 박은 판자와 받침 */
export function barricade(w = 4.0, h = 1.7) {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.BoxGeometry(w * (0.85 + (i % 3) * 0.07), 0.19, 0.045);
    g.rotateZ((i % 2 ? 1 : -1) * (0.04 + i * 0.015));
    g.translate((i % 2 ? 0.1 : -0.08), 0.25 + i * 0.33, 0);
    parts.push(P('accentDark', g));
  }
  parts.push(P('accentDark', box(0.14, h, 0.14, -w / 2 + 0.3, h / 2, -0.12)));
  parts.push(P('accentDark', box(0.14, h, 0.14, w / 2 - 0.3, h / 2, -0.12)));
  const brace = new THREE.BoxGeometry(0.12, h * 1.2, 0.12);
  brace.rotateZ(0.5); brace.translate(0, h * 0.5, -0.22);
  parts.push(P('accentDark', brace));
  return parts;
}

/** 자판기 — 유리 전면 + 배출구 */
export function vendingMachine() {
  const w = 0.9, h = 1.85, d = 0.72;
  return [
    P('accentDark', box(w, h, d, 0, h / 2, 0)),
    P('glass', box(w - 0.16, h * 0.55, 0.03, 0, h * 0.63, d / 2 - 0.01)),
    P('metal', box(w - 0.2, 0.03, 0.3, 0, h * 0.45, d / 2 - 0.18)),   // 선반
    P('metal', box(w - 0.2, 0.03, 0.3, 0, h * 0.66, d / 2 - 0.18)),
    P('accentDark', box(w - 0.3, 0.26, 0.06, 0, 0.34, d / 2)),        // 배출구
    P('metal', box(0.16, 0.5, 0.04, w / 2 - 0.16, h * 0.55, d / 2)),  // 버튼 패널
  ];
}

/** 검사대 — 상판 높이 0.95 를 유지한다 (카드키가 여기 올라간다) */
export function examTable(w = 3.6, d = 0.6) {
  const h = 0.95;
  const parts = [
    P('enamel', box(w, 0.06, d, 0, h - 0.03, 0)),
    P('fabric', box(w - 0.1, 0.05, d - 0.06, 0, h + 0.03, 0)),
    P('metal', box(w - 0.3, 0.03, d - 0.2, 0, h - 0.42, 0)),          // 하단 선반
  ];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    parts.push(P('metal', cyl(0.026, h - 0.06, sx * (w / 2 - 0.14), (h - 0.06) / 2, sz * (d / 2 - 0.1), 6)));
  }
  return parts;
}

/** 계단 — 실제 단을 만든다. 탈출구 표식 */
export function stairs(w = 6.0, steps = 6, rise = 0.2, run = 0.17) {
  const parts = [];
  for (let i = 0; i < steps; i++) {
    parts.push(P('accentDark', box(w, rise, run * (steps - i) + 0.1,
      0, rise / 2 + i * rise, -(run * i) / 2)));
  }
  parts.push(P('metal', cyl(0.028, w, 0, steps * rise + 0.9, run * steps * 0.5, 8, 'x')));
  return parts;
}

/** 넘어진 가구 더미 — 복도 장애물 */
export function rubblePile(w = 1.6, h = 1.2, d = 0.7) {
  const parts = [
    P('enamel', box(w, h * 0.55, d, 0, h * 0.28, 0, 0.12)),
    P('accentDark', box(w * 0.7, 0.05, d * 0.9, 0.1, h * 0.58, 0.05, 0.4)),
  ];
  const top = new THREE.BoxGeometry(w * 0.55, h * 0.42, d * 0.7);
  top.rotateZ(0.42); top.rotateY(0.6);
  top.translate(-0.1, h * 0.72, 0.05);
  parts.push(P('enamel', top));
  parts.push(P('metal', box(0.05, 0.05, w * 0.8, 0.3, h * 0.62, 0, 1.1)));
  return parts;
}

/** 전원 레버 — 벽에 붙은 차단기 박스 + 손잡이 */
export function lever() {
  return [
    P('accentDark', box(0.34, 0.5, 0.16, 0, 1.15, 0)),
    P('metal', box(0.26, 0.4, 0.03, 0, 1.15, 0.09)),
    P('accent', cyl(0.035, 0.24, 0, 1.05, 0.14, 8)),        // 손잡이
    P('metal', cyl(0.05, 0.05, 0, 1.2, 0.12, 8, 'z')),      // 축
    P('accentDark', box(0.42, 0.06, 0.2, 0, 1.44, 0)),      // 상단 갓
  ];
}

/* ───────────────── Phase 4 · 사이니지(판) ───────────────── */

/**
 * 벽에 붙는 판. 아틀라스 텍스처의 한 칸을 UV 로 참조한다.
 * @param {number} col 아틀라스 열, @param {number} row 행, @param {number} cols/rows 분할 수
 */
export function signPlate(w, h, col, row, cols, rows) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (col + uv.getX(i)) / cols, (rows - 1 - row + uv.getY(i)) / rows);
  }
  uv.needsUpdate = true;
  return [P('plate', g)];
}

export const BUILDERS = {
  baseboard, handrail, cornerGuard, vent,
  doorFrame, doorPanel, doorFallen, boardedDoor,
  bed, ivStand, ivStandFallen, wheelchair, cart, cabinet, extinguisher, curtain,
  ceilingLight, emergencyLamp, ceilingTileFallen, ceilingHole, gurneyToppled,
  receptionDesk, chairRow, barricade, vendingMachine, examTable, stairs, rubblePile, lever,
};
