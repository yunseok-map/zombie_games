/**
 * qa_dist.mjs — **빌드 결과물이 실제로 열리는지** 확인한다.
 *
 *   node tools/qa_dist.mjs
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────
 * 나머지 검사는 전부 개발 서버(`vite`)에 붙는다. 그런데 심사자가 보는 것은
 * **`dist/` 를 GitHub Pages 에 올린 것**이다. 둘은 다른 결과물이라 개발 서버에서만
 * 안 나는 사고가 있다 —
 *   · `base: './'` 가 틀어져 에셋 경로가 404
 *   · 청크를 가르면서 로드 순서가 꼬임
 *   · 개발 서버가 관대하게 넘어가던 임포트가 번들에서 깨짐
 * 그래서 CI 는 굽고 나서 **구운 것을 열어 본다.**
 *
 * 여기서 보는 것은 "게임이 살아서 시작할 수 있는가"까지다. 내용 검사는
 * `qa_run.mjs` 가 한다 — 같은 것을 두 번 돌릴 이유가 없다.
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH
  || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 5210;
const URL = `http://127.0.0.1:${PORT}/`;

if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
  console.error('dist/index.html 이 없다. 먼저 `npm run build`.');
  process.exit(1);
}

// vite preview 로 dist 를 그대로 낸다. **npx 를 쓰지 않는다** —
// 윈도우에서 .cmd 를 spawn 하면 EINVAL 이고, shell:true 로 우회하면 서버가 고아로 남는다.
const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const server = spawn(
  process.execPath,
  [viteBin, 'preview', '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, stdio: 'ignore' });
const stopServer = () => {
  if (!server || server.killed) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill(); }
};
const alive = async () => {
  try { return (await fetch(URL, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
};
let up = false;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 500));
  if (await alive()) { up = true; break; }
}
if (!up) { stopServer(); console.error('preview 서버가 안 떴다.'); process.exit(1); }

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--mute-audio', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();

const errors = [];
const missing = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
// 404 는 개발 서버에서 안 나고 배포본에서만 나는 대표적인 사고다
page.on('response', (res) => {
  if (res.status() >= 400) missing.push(`${res.status()} ${res.url().replace(URL, '')}`);
});

let report = null;
try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  // 로딩이 끝나야 시작 버튼이 열린다 — 에셋 전부를 받았다는 뜻이다
  await page.waitForFunction(() => {
    const b = document.getElementById('btn-start');
    return b && !b.disabled;
  }, { timeout: 300000, polling: 500 });
  await page.click('#btn-start');
  // **`stages.length` 를 기다리면 안 된다** — 그건 정적 게터라 타이틀 화면에서도 참이다.
  // 실제로 PLAYING 까지 들어가는지를 봐야 "열리고 시작된다"를 증명한 것이 된다.
  await page.waitForFunction(() => window.game?.state === 'PLAYING',
    { timeout: 180000, polling: 200 });

  report = await page.evaluate(() => {
    const g = window.game;
    return {
      구역: g.stages.length,
      무기: Object.keys(g.weapons?.ammo ?? {}).length,
      좀비풀: g.pool?.all?.length ?? 0,
      상태: g.state,
    };
  });
} finally {
  await browser.close();
  stopServer();
}

console.log('\n=== 배포본(dist) 점검 ===');
console.log(`  구역 ${report?.구역}개 · 좀비 풀 ${report?.좀비풀}마리 · 상태 ${report?.상태}`);
console.log(`  404 등 실패 응답 ${missing.length}건 · 콘솔 오류 ${errors.length}건`);
if (missing.length) console.log('  ' + missing.slice(0, 8).join('\n  '));
if (errors.length) console.log('  ' + errors.slice(0, 5).join('\n  '));

const ok = report?.구역 === 5 && report?.좀비풀 > 0 && report?.상태 === 'PLAYING'
  && missing.length === 0 && errors.length === 0;
console.log(ok ? '\n✅ 배포본이 정상으로 열리고 시작된다' : '\n❌ 배포본에 문제가 있다');
process.exit(ok ? 0 : 1);
