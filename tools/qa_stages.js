/**
 * qa_stages.js — 구역별 자동 QA (개발 전용, 게임에 포함되지 않는다)
 *
 * 사용법 — 브라우저 콘솔에서:
 *   const { runQA } = await import('/tools/qa_stages.js');
 *   console.table(runQA(window.game).flat());
 *
 * 왜 코드로 하는가: 어두운 화면에서는 눈으로 못 찾는 것이 많다.
 * 벽 안에 박힌 소품, 도달 못 하는 상호작용, 바닥 밖에 놓인 물건은
 * 손전등이 그쪽을 비출 때만 보이므로 육안 검사로는 놓친다.
 *
 * 검사 20항목 × 구역 수. 실패는 `ok:false` 로 나오고 detail 에 좌표가 찍힌다.
 */

const PLAYER_R = 0.32;
const ZOMBIE_R = 0.42;
const CEIL_H = 3.0;
const TRI_BUDGET = 350000;
const DRAW_BUDGET = 300;
const ZOMBIE_TRIS = 6000 * 14;      // 하드캡 14마리분

/** 충돌 박스 조회 헬퍼 */
function makeHit(boxes) {
  return (x, z, r) => boxes.some((b) => b.enabled !== false
    && x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r);
}

/**
 * 벽으로 보이는 박스만. **얇고(<0.25m) 길어야(>1m)** 벽이다.
 * 소화기(0.3×0.3)·배전반(0.5×0.3) 처럼 얇기만 한 소품 자기 박스를 벽으로 세면
 * "소품이 자기 자신 안에 박혀 있다"는 오탐이 나온다.
 */
function wallBoxes(boxes) {
  return boxes.filter((b) => {
    const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
    return Math.min(w, d) < 0.25 && Math.max(w, d) > 1.0;
  });
}

/**
 * 시작점에서 갈 수 있는 모든 칸을 한 번에 구한다.
 * 도달 판정을 여러 번 할 때 BFS 를 매번 돌리면 느려서, 영역을 한 번만 만들고 조회한다.
 */
function floodRegion(hit, sx, sz, step = 0.25) {
  const key = (i, j) => `${i},${j}`;
  const si = Math.round(sx / step), sj = Math.round(sz / step);
  const seen = new Set([key(si, sj)]);
  const q = [[si, sj]];
  let n = 0;
  let minX = sx, maxX = sx, minZ = sz, maxZ = sz;
  while (q.length && n++ < 600000) {
    const [i, j] = q.shift();
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj, k = key(ni, nj);
      if (seen.has(k)) continue;
      const x = ni * step, z = nj * step;
      if (hit(x, z, PLAYER_R)) continue;
      seen.add(k); q.push([ni, nj]);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  }
  const has = (x, z, slack = 1) => {
    const i = Math.round(x / step), j = Math.round(z / step);
    for (let a = -slack; a <= slack; a++) {
      for (let b = -slack; b <= slack; b++) if (seen.has(key(i + a, j + b))) return true;
    }
    return false;
  };
  return { has, size: seen.size, bounds: { minX, maxX, minZ, maxZ } };
}

/**
 * 소품 인스턴스 위치를 모은다.
 * 잔해 산포(Scatter)는 제외한다 — 바닥에 흩뿌리는 것이라 문턱·벽 밑에 걸쳐도 정상이고,
 * 수백 개라 검사에 넣으면 오탐만 쏟아진다. (개수로 구분: 산포는 인스턴스가 아주 많다)
 */
function propPlacements(group) {
  const out = [];
  group.traverse((o) => {
    // 잔해(Scatter)는 소품 위에 흩뿌려지는 게 정상이라 겹침으로 세면 안 된다.
    // Scatter.finalize 가 userData.scatter 를 달아 준다.
    if (!o.isInstancedMesh || o.userData.scatter) return;
    const name = o.material?.name || '?';
    for (let i = 0; i < o.count; i++) {
      const e = o.instanceMatrix.array;
      out.push({ name, i, x: e[i * 16 + 12], y: e[i * 16 + 13], z: e[i * 16 + 14] });
    }
  });
  return out;
}

/** 바닥 메시들의 XZ 범위 — 레벨 밖에 놓인 물건을 잡으려는 것 */
function floorBounds(group) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, found = false;
  group.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox;
    if (b.max.y > 0.2) return;                 // 바닥 평면만 (두께가 없다)
    found = true;
    minX = Math.min(minX, b.min.x); maxX = Math.max(maxX, b.max.x);
    minZ = Math.min(minZ, b.min.z); maxZ = Math.max(maxZ, b.max.z);
  });
  return found ? { minX, maxX, minZ, maxZ } : null;
}

/** 모든 사건(레버·무전기·무영등·신호탄)을 해결한 상태로 만든다 */
function solveEvents(game) {
  const items = game.interaction.items ?? game.interaction.list ?? [];
  const arg = { player: game.player };
  // 카드키 문(구역 A)은 아이템이 있어야 열린다. 검사 목적상 미리 쥐여 준다 —
  // 없으면 "출구까지 못 간다"는 오탐이 난다 (실제로는 복도에서 주우면 열린다).
  game.player.items?.add?.('cardkey');
  const fired = [];
  for (const it of items) {
    const p = (() => { try { return it.prompt?.(arg) ?? ''; } catch { return ''; } })();
    if (/무전기|무영등|전원 레버|신호탄/.test(p)) {
      try { it.onUse(arg); fired.push(p); } catch { /* 무시 */ }
    }
  }
  for (const it of items) {
    const p = (() => { try { return it.prompt?.(arg) ?? ''; } catch { return ''; } })();
    if (/문|봉쇄/.test(p)) { try { it.onUse(arg); } catch { /* 무시 */ } }
  }
  return fired.length;
}

function checkStage(game, idx) {
  const stage = game.stages[idx];
  const id = stage.meta.id;
  const R = [];
  const add = (name, ok, detail = '') => R.push({ 구역: id, 항목: name, ok, detail });

  // ── 1. 로드 ──
  let start = null;
  try {
    start = game.stageLoader.load(stage);
    add('01 로드', true);
  } catch (e) {
    add('01 로드', false, String(e).slice(0, 120));
    return R;
  }
  const L = game.stageLoader;
  const boxes = game.collision.boxes;
  const hit = makeHit(boxes);
  const walls = wallBoxes(boxes);
  const wallHit = makeHit(walls);
  const props = propPlacements(L.group);
  const fb = floorBounds(L.group);
  const items = game.interaction.items ?? game.interaction.list ?? [];

  // ── 2~4. 시작 지점 ──
  add('02 시작지점 충돌없음', !hit(start.x, start.z, PLAYER_R), `(${start.x}, ${start.z})`);
  add('03 시작지점 바닥위', !fb || (start.x > fb.minX && start.x < fb.maxX
    && start.z > fb.minZ && start.z < fb.maxZ));
  add('04 시작 시야각 유효', Number.isFinite(start.yaw ?? 0));

  // ── 5~7. 스폰 ──
  const badSpawn = L.spawnPoints.filter((s) => hit(s.x, s.z, ZOMBIE_R));
  add('05 스폰 충돌없음', badSpawn.length === 0,
    badSpawn.map((s) => `(${s.x.toFixed(1)},${s.z.toFixed(1)})`).join(' '));
  const outSpawn = fb ? L.spawnPoints.filter((s) => s.x < fb.minX || s.x > fb.maxX
    || s.z < fb.minZ || s.z > fb.maxZ) : [];
  add('06 스폰 바닥위', outSpawn.length === 0,
    outSpawn.map((s) => `(${s.x},${s.z})`).join(' '));
  add('07 스폰 개수 충분', L.spawnPoints.length >= 6, `${L.spawnPoints.length}개`);

  // ── 8~10. 소품 배치 ──
  const buried = props.filter((p) => wallHit(p.x, p.z, 0.05));
  add('08 소품이 벽에 안 박힘', buried.length === 0,
    buried.slice(0, 4).map((p) => `${p.name}(${p.x.toFixed(1)},${p.z.toFixed(1)})`).join(' '));
  const outside = fb ? props.filter((p) => p.x < fb.minX - 0.5 || p.x > fb.maxX + 0.5
    || p.z < fb.minZ - 0.5 || p.z > fb.maxZ + 0.5) : [];
  add('09 소품이 레벨 안', outside.length === 0,
    outside.slice(0, 4).map((p) => `${p.name}(${p.x.toFixed(1)},${p.z.toFixed(1)})`).join(' '));
  const airborne = props.filter((p) => p.y < -0.05 || p.y > CEIL_H);
  add('10 소품 높이 정상', airborne.length === 0,
    airborne.slice(0, 4).map((p) => `${p.name} y=${p.y.toFixed(2)}`).join(' '));

  // ── 11~13. 상호작용 ──
  add('11 상호작용 존재', items.length > 0, `${items.length}개`);
  const unreachable = items.filter((it) => {
    const r = it.radius ?? 1.8;
    for (let a = 0; a < 8; a++) {
      const th = (a / 8) * Math.PI * 2;
      if (!hit(it.x + Math.cos(th) * r * 0.7, it.z + Math.sin(th) * r * 0.7, PLAYER_R)) return false;
    }
    return true;
  });
  add('12 상호작용 도달가능', unreachable.length === 0,
    unreachable.slice(0, 4).map((it) => `(${it.x.toFixed(1)},${it.z.toFixed(1)})`).join(' '));
  const dupItems = items.filter((a, i) => items.some((b, j) =>
    j > i && Math.hypot(a.x - b.x, a.z - b.z) < 0.4));
  add('13 상호작용 안겹침', dupItems.length === 0,
    dupItems.slice(0, 3).map((it) => `(${it.x.toFixed(1)},${it.z.toFixed(1)})`).join(' '));

  // ── 14~16. 예산 ──
  let dc = 0, tris = 0, shadowCasters = 0;
  L.group.traverse((o) => {
    if (!o.isMesh) return;
    dc++;
    if (o.castShadow) shadowCasters++;
    const t = (o.geometry.index ? o.geometry.index.count
      : o.geometry.attributes.position.count) / 3;
    tris += o.isInstancedMesh ? t * o.count : t;
  });
  add('14 드로우콜 예산', dc <= DRAW_BUDGET, `${dc} / ${DRAW_BUDGET}`);
  add('15 삼각형 예산', tris + ZOMBIE_TRIS <= TRI_BUDGET,
    `${Math.round(tris + ZOMBIE_TRIS).toLocaleString()} / ${TRI_BUDGET.toLocaleString()}`);
  let shadowLights = 0;
  game.scene.traverse((o) => { if (o.isLight && o.castShadow) shadowLights++; });
  add('16 그림자 광원 ≤2', shadowLights <= 2, `${shadowLights}개`);

  // ── 17~19. 진행 ──
  const solved = solveEvents(game);
  const openHit = makeHit(game.collision.boxes);
  // 옥상처럼 시간이 지나야 열리는 출구는 exitPending 으로 예정 지점을 알려준다
  const exit = L.exit ?? L.exitPending;
  const delayed = !L.exit && !!L.exitPending;
  add('17 사건 해결 가능', true, solved ? `레버·무전 ${solved}개 작동` : '사건 없음');
  add('18 출구 존재', !!exit,
    exit ? `(${exit.x}, ${exit.z})${delayed ? ' — 시간차 개방' : ''}` : '없음');

  // 문을 연 상태에서 시작점 기준 이동 가능 영역을 한 번만 구한다
  const region = floodRegion(openHit, start.x, start.z);
  add('19 시작→출구 경로', !exit || region.has(exit.x, exit.z, 2),
    exit ? `→ (${exit.x}, ${exit.z}) · 영역 ${region.size}칸` : '건너뜀');

  // ── 21~25. 진행 불가를 만드는 것들 ──
  const lostSpawns = L.spawnPoints.filter((s) => !region.has(s.x, s.z, 3));
  add('21 스폰이 갇히지 않음', lostSpawns.length === 0,
    lostSpawns.map((s) => `(${s.x.toFixed(1)},${s.z.toFixed(1)})`).join(' '));

  const lostItems = items.filter((it) => !region.has(it.x, it.z, Math.ceil((it.radius ?? 1.8) / 0.25)));
  add('22 상호작용 도달영역 안', lostItems.length === 0,
    lostItems.slice(0, 4).map((it) => `(${it.x.toFixed(1)},${it.z.toFixed(1)})`).join(' '));

  const rb = region.bounds;
  const escaped = fb && (rb.minX < fb.minX - 1 || rb.maxX > fb.maxX + 1
    || rb.minZ < fb.minZ - 1 || rb.maxZ > fb.maxZ + 1);
  add('23 영역이 닫혀 있음', !escaped,
    escaped ? `영역 x[${rb.minX.toFixed(1)},${rb.maxX.toFixed(1)}] `
      + `z[${rb.minZ.toFixed(1)},${rb.maxZ.toFixed(1)}] vs 바닥 `
      + `x[${fb.minX.toFixed(1)},${fb.maxX.toFixed(1)}] z[${fb.minZ.toFixed(1)},${fb.maxZ.toFixed(1)}]` : '');

  // Director 는 시작점에서 spawnMinDistance(12m) 안쪽 스폰은 쓰지 않는다.
  // 그러니 "가까운 게 있는가"가 아니라 "먼 게 충분한가"를 봐야 한다 —
  // 전부 가까우면 구역 시작 직후 좀비가 하나도 안 나온다.
  const farSpawns = L.spawnPoints.filter((s) => Math.hypot(s.x - start.x, s.z - start.z) >= 12);
  add('24 원거리 스폰 충분', farSpawns.length >= 3,
    `${farSpawns.length} / ${L.spawnPoints.length}개가 12m 밖`);

  // 소품 겹침. 같은 모델의 파트끼리(침대 Base/Mattres/Legs)는 좌표가 같으므로 제외하고,
  // 위아래로 쌓인 것(수술대 위 무영등, 영안실 서랍 3단)도 겹침이 아니다.
  const overlap = [];
  for (let a = 0; a < props.length; a++) {
    for (let b = a + 1; b < props.length; b++) {
      const A = props[a], B = props[b];
      const d = Math.hypot(A.x - B.x, A.z - B.z);
      if (d < 0.05) continue;                       // 같은 소품의 다른 파트
      if (Math.abs(A.y - B.y) > 0.5) continue;      // 위아래로 겹친 것은 정상
      if (d < 0.45) overlap.push(`${A.name}/${B.name}(${A.x.toFixed(1)},${A.z.toFixed(1)})`);
    }
  }
  add('25 소품끼리 안 겹침', overlap.length === 0, [...new Set(overlap)].slice(0, 5).join(' '));

  // ── 20. 언로드 누수 ──
  const before = game.scene.children.length;
  L.unload();
  const after = game.scene.children.length;
  add('20 언로드 정리', after < before, `씬 자식 ${before} → ${after}`);

  return R;
}

export function runQA(game) {
  const all = [];
  for (let i = 0; i < game.stages.length; i++) all.push(checkStage(game, i));
  // 마지막 검사가 unload 로 끝나므로 그대로 두면 화면이 비어 버린다. 첫 구역으로 되돌린다.
  game.stageLoader.load(game.stages[0]);
  return all;
}

export function summarize(rows) {
  const flat = rows.flat();
  const fail = flat.filter((r) => !r.ok);
  return {
    총검사: flat.length,
    통과: flat.length - fail.length,
    실패: fail.length,
    실패목록: fail.map((f) => `${f.구역} · ${f.항목} — ${f.detail}`),
  };
}
