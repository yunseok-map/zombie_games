/**
 * qa_run.mjs — 자동 검사 전체를 **사람 없이** 한 번에 돌린다.
 *
 *   node tools/qa_run.mjs              # 구역 검사 + 모션 검사
 *   node tools/qa_run.mjs --stages     # 구역 검사만 (빠름)
 *   node tools/qa_run.mjs --motion     # 모션 검사만
 *   node tools/qa_run.mjs --head       # 크롬 창을 띄워서 눈으로 보며
 *
 * 필요한 것 (게임 빌드와 무관해서 package.json 에 넣지 않았다):
 *   npm i --no-save puppeteer-core
 *
 * ── 왜 이게 있어야 하는가 ────────────────────────────────────────────────
 * `tools/qa_stages.js` · `qa_motion.js` 는 **사람이 브라우저 콘솔에 붙여넣어야만**
 * 도는 물건이었다. 그래서 "5층 40회 결함 0건" 같은 검증을 돌린 하네스가 매번
 * 임시 폴더에서 태어났다 사라졌고, **같은 검증을 다시 할 수가 없었다.**
 * 이 파일이 그 하네스의 영구 거처다. 리팩터링 전후로 이걸 돌려서 비교한다.
 *
 * ── 알아 둘 것 ──────────────────────────────────────────────────────────
 * · **개발 서버로 돌린다.** 검사 모듈이 `/tools/*.js` 로 임포트되는데 빌드 산출물
 *   (dist/)에는 tools/ 가 없다. 개발 서버만 프로젝트 루트를 그대로 서빙한다.
 * · **여기서 잰 프레임 시간·로딩 시간은 믿지 마라.** 헤드리스는 SwiftShader 로
 *   소프트웨어 렌더링이라 실제 GPU 와 무관하다. 성능은 `tools/bench.js` 를
 *   실제 크롬에서 돌려야 한다. 여기서 보는 것은 **논리·배치·모션의 옳고 그름**이다.
 * · vite 설정이 `open: true` 라 그냥 띄우면 **사용자 크롬에 탭이 열린다.**
 *   `--no-open` 을 강제하고 전용 포트를 쓴다.
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// CI(리눅스)에는 이 경로가 없다. 워크플로가 CHROME_PATH 로 알려준다.
const CHROME = process.env.CHROME_PATH
  || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 5199;                     // 사람이 쓰는 5180 과 겹치지 않게
const URL = `http://127.0.0.1:${PORT}/`;

const argv = process.argv.slice(2);
const only = argv.includes('--stages') ? 'stages'
           : argv.includes('--motion') ? 'motion' : 'all';
const headed = argv.includes('--head');

const log = (...a) => console.log(...a);

// ───────────── 개발 서버 ─────────────
async function alive() {
  try { return (await fetch(URL, { signal: AbortSignal.timeout(1500) })).ok; }
  catch { return false; }
}

let server = null;
async function ensureServer() {
  if (await alive()) { log(`개발 서버 재사용 — ${URL}`); return; }
  log(`개발 서버 시작 — ${URL}`);
  server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', '--port', String(PORT), '--strictPort', '--no-open'],
    { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' });
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await alive()) return;
  }
  throw new Error('개발 서버가 30초 안에 뜨지 않았다');
}
const stopServer = () => { if (server && !server.killed) server.kill(); };

// ───────────── 실행 ─────────────
await ensureServer();

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: headed ? false : 'new',
  args: ['--mute-audio', '--use-gl=angle', '--use-angle=swiftshader',
         '--window-size=1280,720', '--no-sandbox'],
  protocolTimeout: 1800000,
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });

// 잡이슈 — 콘솔 에러와 죽은 요청은 검사 항목과 별개로 모은다.
// 자동 검사가 다 통과해도 에셋이 404 면 게임은 망가진 것이다(실제로 그런 적 있다).
const noise = [];
page.on('console', m => { if (m.type() === 'error') noise.push(`콘솔 ${m.text()}`); });
page.on('pageerror', e => noise.push(`JS ${e.message}`));
page.on('requestfailed', r => noise.push(`요청실패 ${r.failure()?.errorText} ${r.url()}`));
page.on('response', r => { if (r.status() >= 400) noise.push(`HTTP ${r.status()} ${r.url()}`); });

let failed = 0;
try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });

  // 에셋 프리로드가 끝나야 시작 버튼이 풀린다 (main.js). GLB 가 커서 오래 걸린다.
  log('에셋 프리로드 대기…');
  await page.waitForFunction(
    () => { const b = document.getElementById('btn-start'); return b && !b.disabled; },
    { timeout: 300000, polling: 500 });

  await page.click('#btn-start');
  await page.waitForFunction(() => window.game && window.game.stages?.length > 0,
    { timeout: 120000, polling: 200 });

  // 렌더 루프를 세운다. 헤드리스는 1fps 라 루프를 살려 두면 검사가 하염없이 늘어진다.
  // 검사 모듈은 필요한 갱신을 스스로 고정 dt 로 돌린다.
  await page.evaluate(() => { window.game.state = 'PAUSED'; });
  log('게임 준비됨 — 검사 시작\n');

  // ── 구역 검사 (25항목 × 5구역) ──
  if (only !== 'motion') {
    const r = await page.evaluate(async () => {
      const { runQA, summarize } = await import('/tools/qa_stages.js');
      const rows = runQA(window.game);
      return { sum: summarize(rows), perStage: rows.map(s => ({
        구역: s[0]?.구역 ?? '?',
        검사: s.length,
        실패: s.filter(x => !x.ok).length,
      })) };
    });
    log('=== 구역 검사 ===');
    console.table(r.perStage);
    log(`총 ${r.sum.총검사}항목 · 통과 ${r.sum.통과} · 실패 ${r.sum.실패}`);
    if (r.sum.실패) { failed += r.sum.실패; log('실패 목록:\n  ' + r.sum.실패목록.join('\n  ')); }
    log('');
  }

  // ── 모션 검사 (프레임 단위) ──
  if (only !== 'stages') {
    const r = await page.evaluate(async () => {
      const { runMotionQA, summarize } = await import('/tools/qa_motion.js');
      return summarize(await runMotionQA(window.game));
    });
    log('=== 모션 검사 ===');
    log(`총 ${r.총프레임}프레임 · 문제 ${r.문제프레임}프레임`);
    if (r.문제프레임) {
      failed += r.문제프레임;
      for (const [k, v] of Object.entries(r.문제)) log(`  ${k}: ${v.join(' · ')}`);
    }
    log('');
  }
} finally {
  await browser.close();
  stopServer();
}

// ── 잡이슈 ──
const uniq = [...new Set(noise)];
log(`=== 잡이슈 (콘솔·네트워크) === ${uniq.length}건`);
uniq.slice(0, 15).forEach(n => log('  ' + n));
if (uniq.length > 15) log(`  … 외 ${uniq.length - 15}건`);

const bad = failed + uniq.length;
log('\n' + (bad === 0 ? '✅ 전부 통과 — 결함 0건'
                      : `❌ 문제 ${bad}건 (검사 실패 ${failed} · 잡이슈 ${uniq.length})`));
process.exit(bad === 0 ? 0 : 1);
