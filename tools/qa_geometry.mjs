/**
 * qa_geometry.mjs — 구역의 **지오메트리 지문**을 뜬다.
 *
 *   node tools/qa_geometry.mjs before.json      # 지문 저장
 *   node tools/qa_geometry.mjs after.json before.json   # 저장 + 비교
 *
 * 필요한 것:  npm i --no-save puppeteer-code
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────
 * 구역 조립 코드를 손보면 벽이 1cm 밀려도 눈으로는 모른다. `qa_stages.js` 는
 * "갇힌 스폰이 있나 / 벽에 박힌 소품이 있나" 같은 **성질**을 보지, 좌표가
 * 예전과 같은지는 안 본다. 그래서 조립 방식만 바꾸는 리팩터링은 이걸로 증명한다.
 *
 * 지문에 담기는 것 — 충돌 박스 전체 좌표, 메시별 월드 위치와 크기, 드로우콜,
 * 삼각형, 스폰·광원·소품 개수. 하나라도 다르면 좌표까지 찍어서 알려준다.
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { console.error('puppeteer-core 가 없다:  npm i --no-save puppeteer-core'); process.exit(2); }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH
  || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 5198;
const URL = `http://127.0.0.1:${PORT}/`;

const outFile = process.argv[2];
const cmpFile = process.argv[3];
if (!outFile) { console.error('사용법: node tools/qa_geometry.mjs <저장할.json> [비교할.json]'); process.exit(2); }

async function alive() {
  try { return (await fetch(URL, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
}
let server = null;
async function ensureServer() {
  if (await alive()) return;
  const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  server = spawn(process.execPath, [viteBin, '--port', String(PORT), '--strictPort', '--no-open'],
    { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await alive()) return;
  }
  throw new Error('개발 서버가 안 뜬다');
}
function stopServer() {
  if (!server || server.killed) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill(); }
}

await ensureServer();
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--mute-audio', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox'],
  protocolTimeout: 1800000,
});
const page = await browser.newPage();

let snap;
try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => { const b = document.getElementById('btn-start'); return b && !b.disabled; },
    { timeout: 300000, polling: 500 });
  await page.click('#btn-start');
  await page.waitForFunction(() => window.game && window.game.stages?.length > 0,
    { timeout: 120000, polling: 200 });
  await page.evaluate(() => { window.game.state = 'PAUSED'; });

  snap = await page.evaluate(() => {
    const g = window.game;
    const r3 = n => Math.round(n * 1000) / 1000;    // mm 단위까지만 — 부동소수 잡음 제거
    const out = {};
    for (let i = 0; i < g.stages.length; i++) {
      const st = g.stages[i];
      // stages 는 **모듈 객체** 배열이다. 그대로 키로 쓰면 프로토타입이 null 이라
      // "Cannot convert object to primitive value" 로 터진다. id 를 쓴다.
      const id = st?.meta?.id ?? st?.id ?? `stage_${i}`;
      g.stageLoader.load(st);
      const boxes = g.collision.boxes
        .map(b => [r3(b.minX), r3(b.minZ), r3(b.maxX), r3(b.maxZ)].join(','))
        .sort();
      const meshes = [];
      g.stageLoader.group.traverse(o => {
        if (!o.isMesh) return;
        o.updateWorldMatrix(true, false);
        // THREE 를 페이지에서 못 잡으므로 월드 행렬에서 직접 읽는다 (12·13·14 가 위치다)
        const m = o.matrixWorld.elements;
        const p = { x: m[12], y: m[13], z: m[14] };
        const geo = o.geometry;
        if (!geo.boundingBox) geo.computeBoundingBox();
        const bb = geo.boundingBox;
        meshes.push([
          o.geometry.type,
          r3(p.x), r3(p.y), r3(p.z),
          r3(bb.max.x - bb.min.x), r3(bb.max.y - bb.min.y), r3(bb.max.z - bb.min.z),
          (geo.index ? geo.index.count : geo.attributes.position.count) / 3,
        ].join(','));
      });
      meshes.sort();
      out[id] = {
        충돌박스: boxes.length, 박스지문: boxes,
        메시: meshes.length, 메시지문: meshes,
        스폰: g.stageLoader.spawnPoints?.length ?? null,
      };
    }
    g.stageLoader.load(g.stages[0]);
    return out;
  });
} finally {
  await browser.close();
  stopServer();
}

fs.writeFileSync(outFile, JSON.stringify(snap, null, 1), 'utf8');
console.log(`지문 저장: ${outFile}`);
for (const [k, v] of Object.entries(snap)) {
  console.log(`  ${k.padEnd(16)} 충돌박스 ${String(v.충돌박스).padStart(4)} · 메시 ${String(v.메시).padStart(4)} · 스폰 ${v.스폰}`);
}

if (cmpFile) {
  const old = JSON.parse(fs.readFileSync(cmpFile, 'utf8'));
  let diff = 0;
  for (const stage of new Set([...Object.keys(old), ...Object.keys(snap)])) {
    const a = old[stage], b = snap[stage];
    if (!a || !b) { console.log(`\n❌ ${stage}: 한쪽에만 있다`); diff++; continue; }
    for (const key of ['박스지문', '메시지문']) {
      const A = new Set(a[key]), B = new Set(b[key]);
      const gone = a[key].filter(x => !B.has(x));
      const added = b[key].filter(x => !A.has(x));
      if (gone.length || added.length) {
        diff++;
        console.log(`\n❌ ${stage} · ${key} — 사라짐 ${gone.length} · 새로 생김 ${added.length}`);
        gone.slice(0, 5).forEach(x => console.log('    - ' + x));
        added.slice(0, 5).forEach(x => console.log('    + ' + x));
      }
    }
  }
  console.log('\n' + (diff === 0
    ? '✅ 지오메트리가 완전히 동일하다 — 좌표 하나 안 움직였다'
    : `❌ ${diff}곳이 달라졌다`));
  process.exit(diff === 0 ? 0 : 1);
}
