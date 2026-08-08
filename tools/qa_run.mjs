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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  console.error('puppeteer-core 가 없다. 아래를 먼저 실행한다:\n' +
    '  npm i --no-save puppeteer-core\n' +
    '(주의: 그 뒤에 다른 `npm i --no-save ...` 를 돌리면 이게 다시 걷힌다 — 실제로 그랬다)');
  process.exit(2);
}

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
  // npx 를 거치지 않고 vite 를 **직접** 띄운다. 이유가 둘이다:
  //  · 요즘 Node 는 보안상 `.cmd` 를 shell 없이 실행하지 못한다 (spawn EINVAL).
  //  · shell 을 켜면 vite 가 손자 프로세스가 되어 죽여도 안 죽는다.
  const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(viteBin)) throw new Error(`vite 를 못 찾았다: ${viteBin} — npm ci 를 먼저 돌린다`);
  server = spawn(process.execPath,
    [viteBin, '--port', String(PORT), '--strictPort', '--no-open'],
    { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await alive()) return;
  }
  throw new Error('개발 서버가 30초 안에 뜨지 않았다');
}

/**
 * npx 는 vite 를 **자식으로** 띄운다. npx 만 죽이면 vite 가 고아로 남아 포트를 계속
 * 물고 있다 — 다음 실행이 그 낡은 서버를 "재사용"해서, 방금 고친 코드가 아니라
 * 옛날 코드를 검사하게 된다. 조용히 틀린 결과가 나오는 종류의 사고다.
 * 그래서 프로세스 트리째 죽인다.
 */
function stopServer() {
  if (!server || server.killed) return;
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); }
    catch { server.kill(); }
  } else {
    try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill(); }
  }
}

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
  // ── 전투 검사 ──
  // 구역·모션 검사는 **총을 쏘지도 휘두르지도 않는다.** 그래서 발사·타격·재장전
  // 경로에 있던 오류가 두 번이나 검사를 전부 통과한 채 살아남았다
  //   · 빗나간 총알이 벽에 닿는 순간 터짐 (지역변수 z 가 인스턴스를 가림)
  //   · 재장전 도중 터짐 (bus·EV 임포트 누락)
  // 둘 다 "그 코드를 한 번도 실행하지 않아서" 안 보였던 것이다. 여기서 다 밟는다.
  if (only !== 'motion') {
    const r = await page.evaluate(async () => {
      const g = window.game, W = g.weapons, P = g.player;
      const errs = [];
      const run = (label, fn) => { try { fn(); } catch (e) { errs.push(`${label}: ${e.message}`); } };
      const step = (n, dt = 1 / 60) => {
        for (let i = 0; i < n; i++) run('뷰모델 갱신', () => W._animateViewModel(dt, null));
      };

      // 좀비 하나를 눈앞에 세운다 — 맞히는 경로와 빗나가는 경로를 모두 밟기 위해
      let zb = null;
      run('좀비 스폰', () => {
        zb = g.pool.spawnAt?.('shambler', P.pos.x, P.pos.z - 2)
          ?? g.pool.zombies?.find(z => z.active);
      });

      for (let slot = 1; slot <= 3; slot++) {
        run(`무기 ${slot} 전환`, () => W.switchTo(slot));
        const def = W.current;
        if (!def) continue;
        const tag = `${def.id}(${def.type})`;
        if (def.type === 'gun') {
          run(`${tag} 탄약 지급`, () => W.addAmmo(def.id, 60));
          // 위를 보고 쏜다 → 반드시 빗나가서 벽·천장 추적 경로를 탄다
          P.pitch = -1.2; run(`${tag} 카메라 갱신`, () => P._syncCamera(1 / 60));
          for (let i = 0; i < 3; i++) { run(`${tag} 발사(빗맞힘)`, () => W.attack()); W.cooldown = 0; step(4); }
          // 정면으로 쏜다 → 명중 경로
          P.pitch = 0; run(`${tag} 카메라 갱신`, () => P._syncCamera(1 / 60));
          for (let i = 0; i < 3; i++) { run(`${tag} 발사(명중)`, () => W.attack()); W.cooldown = 0; step(4); }
          run(`${tag} 재장전 시작`, () => W.reload());
          step(200);                       // 재장전이 끝날 때까지 — 중간의 '철컥' 경로를 밟는다
        } else {
          for (let i = 0; i < 3; i++) {
            run(`${tag} 휘두름`, () => W.attack());
            W.cooldown = 0;
            step(70);                      // 예비동작 → 타격(판정) → 마무리 전부
          }
        }
      }
      return { errs, 무기수: Object.keys(W.ammo ?? {}).length };
    });
    log('=== 전투 검사 ===');
    log(`발사·타격·재장전 경로 실행 — 오류 ${r.errs.length}건`);
    if (r.errs.length) { failed += r.errs.length; r.errs.slice(0, 12).forEach(e => log('  ' + e)); }
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
