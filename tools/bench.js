/**
 * bench.js — 프레임 측정 (개발 전용, 게임에 포함되지 않는다)
 *
 * 사용법 — 브라우저 콘솔에서:
 *   const { bench, benchAll } = await import('/tools/bench.js');
 *   console.table(await benchAll(window.game));
 *
 * **작업할 때마다 돌린다.** 시각 효과는 하나씩 보면 다 싸 보이는데 합치면 예산을 넘긴다.
 *
 * 측정이 흔들리는 이유와 대응
 *   - 첫 프레임은 셰이더를 컴파일하느라 수십 ms 가 걸린다 → 워밍업을 버린다
 *   - 백그라운드 탭·다른 창의 GPU 사용에 크게 흔들린다 → 여러 번 재고 **중앙값의 중앙값**
 *   - 평균은 한 번의 튐에 끌려간다 → 평균 대신 중앙값
 *   측정값 하나로 판단하면 오진한다. 실제로 18.2ms 로 나왔던 것이 재측정에서 13.1ms 였다.
 */

const TARGET_MS = 16.67;      // 60fps

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

function runOnce(game, frames) {
  const t = [];
  for (let i = 0; i < frames; i++) {
    const t0 = performance.now();
    game.flashlight.update(0.016);
    game.post.render(0.016);
    t.push(performance.now() - t0);
  }
  return median(t);
}

/**
 * GPU 시간 측정 (EXT_disjoint_timer_query_webgl2).
 *
 * 벽시계(performance.now)로 재면 **다른 프로그램이 CPU 를 쓰는 것까지 같이 잰다.**
 * 실제로 같은 코드가 19.2ms 와 26.3ms 로 나와서 판단이 불가능했다.
 * 타이머 쿼리는 GPU 가 그 프레임을 그리는 데 쓴 시간만 재므로 훨씬 덜 흔들린다.
 * 확장을 못 쓰는 환경이면 null 을 돌려주고 호출부가 벽시계로 떨어진다.
 */
async function gpuMs(game, frames) {
  const gl = game.renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return null;

  // 쿼리를 **먼저 다 발급**하고 결과는 끝에 한 번만 회수한다.
  // 프레임마다 기다리면 안 된다 — 백그라운드 탭에서는 setTimeout 이 1초까지 늘어나서
  // 16프레임을 재는 데 16초가 걸리고 개발자도구 연결이 끊긴다.
  const queries = [];
  for (let i = 0; i < frames; i++) {
    const q = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    game.flashlight.update(0.016);
    game.post.render(0.016);
    gl.endQuery(ext.TIME_ELAPSED_EXT);      // 한 번에 하나만 활성이면 된다
    queries.push(q);
  }
  for (let w = 0; w < 12; w++) {
    if (gl.getQueryParameter(queries[queries.length - 1], gl.QUERY_RESULT_AVAILABLE)) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
  const samples = [];
  for (const q of queries) {
    if (!disjoint && gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
      samples.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);   // ns → ms
    }
    gl.deleteQuery(q);
  }
  return samples.length ? median(samples) : null;
}

/** 한 구역을 재고 프레임 시간(ms)과 예산 정보를 돌려준다 */
export async function bench(game, { stage = 2, zombies = 14, frames = 22, runs = 2 } = {}) {
  game.stageLoader.load(game.stages[stage]);
  game.pool.despawnAll();
  for (let i = 0; i < zombies; i++) {
    game.pool.spawn('shambler', (i % 7) * 2 - 6, 12 + Math.floor(i / 7) * 3);
  }
  game.flashlight.on = true;
  game.flashlight.battery = 100;

  for (let i = 0; i < 35; i++) { game.flashlight.update(0.016); game.post.render(0.016); }  // 워밍업

  // GPU 시간이 우선. 못 재면 벽시계로 떨어진다(그때는 값이 흔들린다는 걸 표시한다).
  //
  // **첫 측정은 버린다.** 구역을 갈아치운 직후에는 텍스처·셰이더를 GPU 에 다시
  // 올리는 시간이 프레임에 섞여서 값이 몇 배로 튄다 (62.5ms → 재측정 16.3ms).
  // 워밍업 프레임만으로는 모자란다 — 업로드가 그보다 오래 걸린다.
  await gpuMs(game, 6);
  const gpu = await gpuMs(game, Math.min(frames, 16));
  const ms = gpu ?? median(Array.from({ length: runs }, () => runOnce(game, frames)));

  let dc = 0, tris = 0;
  game.scene.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    dc++;
    const t = (o.geometry.index ? o.geometry.index.count
      : o.geometry.attributes.position.count) / 3;
    tris += o.isInstancedMesh ? t * o.count : t;
  });
  const mem = game.renderer.info.memory;

  return {
    구역: game.stages[stage].meta.id,
    좀비: zombies,
    ms: +ms.toFixed(2),
    출처: gpu ? 'GPU' : '벽시계(흔들림)',
    fps: Math.round(1000 / ms),
    예산: ms <= TARGET_MS ? 'OK' : `초과 +${(ms - TARGET_MS).toFixed(1)}ms`,
    드로우콜: dc,
    삼각형: Math.round(tris),
    텍스처: mem.textures,
    지오메트리: mem.geometries,
  };
}

/**
 * 전 구역 측정. 가장 무거운 구역이 기준이 된다.
 * 동기 렌더라 한 번에 다 돌리면 개발자도구 연결이 끊긴다(45초 제한) —
 * 구역 사이에 프레임을 양보한다.
 */
export async function benchAll(game, opts = {}) {
  const rows = [];
  for (let i = 0; i < game.stages.length; i++) {
    rows.push(await bench(game, { ...opts, stage: i }));
    await new Promise((r) => setTimeout(r, 0));
  }
  game.pool.despawnAll();
  game.stageLoader.load(game.stages[0]);
  const worst = rows.reduce((a, b) => (a.ms > b.ms ? a : b));
  rows.push({ 구역: '── 최악', ms: worst.ms, fps: worst.fps, 예산: worst.예산 });
  return rows;
}

/**
 * 켜고 끌 수 있는 효과들의 개별 비용. 무엇을 끌지 정할 때 쓴다.
 * (끄는 방법이 없는 것은 여기에 못 넣는다 — 그건 코드를 바꿔서 재야 한다)
 */
export async function benchFeatures(game, opts = {}) {
  const base = { stage: 2, zombies: 14, ...opts };
  const out = [];
  const measure = async (name) => out.push({ 항목: name, ...(await bench(game, base)) });

  await measure('현재 설정');

  const dust = game.flashlight.volume;
  const wasDust = dust.visible;
  dust.visible = false; await measure('먼지 끔'); dust.visible = wasDust;

  const ml = game.weapons.muzzleLight;
  const parent = ml.parent;
  ml.removeFromParent(); await measure('총구 광원 끔'); parent?.add(ml);

  const b = out[0].ms;
  for (const r of out) r.차이 = `${(r.ms - b >= 0 ? '+' : '')}${(r.ms - b).toFixed(2)}ms`;
  return out;
}
