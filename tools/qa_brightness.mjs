/**
 * qa_brightness.mjs — 구역별 화면 밝기를 잰다.
 *
 *   node tools/qa_brightness.mjs [저장.json] [비교.json]
 *
 * 지표는 세 개다.
 *   · **먹통 비율** — 휘도 0.02 미만인 픽셀. "비춰도 안 보인다"의 실체다.
 *   · 평균 휘도    — 화면 전체의 밝기
 *   · 탄 픽셀      — 휘도 0.99 초과. 어둠 게임에서 이게 늘면 분위기가 깨진다
 *
 * ── 알아 둘 것 ──────────────────────────────────────────────────────────
 * · **한 페이지 안에서 A/B 해야 한다.** 페이지를 새로 띄워 비교하면 노출·환경맵
 *   초기화 타이밍이 섞여 40배짜리 헛수치가 나온다 (실제로 그런 적이 있다).
 *   그래서 이 도구는 한 번 띄운 뒤 구역만 갈아 끼우며 잰다.
 * · 첫 프레임은 버린다. 구역을 바꾼 직후에는 텍스처·셰이더 업로드가 섞인다.
 * · 손전등을 **켠 상태**로 잰다 — 플레이어가 실제로 보는 화면이 그것이다.
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const { PNG } = require('pngjs');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH
  || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 5195;
const URL = `http://127.0.0.1:${PORT}/`;

const outFile = process.argv[2];
const cmpFile = process.argv[3];

const alive = async () => {
  try { return (await fetch(URL, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
};
let server = null;
if (!(await alive())) {
  const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  server = spawn(process.execPath, [viteBin, '--port', String(PORT), '--strictPort', '--no-open'],
    { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 500)); if (await alive()) break; }
}
const stopServer = () => {
  if (!server || server.killed) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill(); }
};

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--mute-audio', '--use-gl=angle', '--use-angle=swiftshader',
         '--no-sandbox', '--window-size=960,540'],
  protocolTimeout: 1800000,
});
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 540 });

const stats = {};
try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => { const b = document.getElementById('btn-start'); return b && !b.disabled; },
    { timeout: 300000, polling: 500 });
  await page.click('#btn-start');
  await page.waitForFunction(() => window.game?.stages?.length > 0, { timeout: 120000, polling: 200 });

  const ids = await page.evaluate(() => {
    const g = window.game;
    g.state = 'PAUSED';
    document.querySelectorAll('.screen').forEach(e => e.classList.add('hide'));
    return g.stages.map((s, i) => s?.meta?.id ?? `stage_${i}`);
  });

  for (let i = 0; i < ids.length; i++) {
    // 구역을 갈아 끼우고 시작 지점에 서서 정면(+Z)을 본다. 손전등은 켠다.
    await page.evaluate((idx) => {
      const g = window.game;
      const start = g.stageLoader.load(g.stages[idx]);
      // **옥상은 시작 지점에서 재면 안 된다.** 거기는 계단탑 *안*이라 벽만 잡힌다
      // (PROGRESS.md 함정에 같은 내용이 스크린샷 기준으로 적혀 있다).
      // 실제로 플레이어가 서는 헬리패드 둘레에서 잰다.
      const id = g.stages[idx]?.meta?.id;
      const spot = id === 'hospital_roof' ? { x: 0, z: 26 } : start;
      g.player.pos.set(spot?.x ?? 0, 0, spot?.z ?? 0);
      g.player.yaw = 0; g.player.pitch = 0;
      g.flashlight.on = true;
      g.camera.rotation.order = 'YXZ';
      g.camera.position.set(g.player.pos.x, g.player.eyeHeight, g.player.pos.z);
      g.camera.rotation.set(0, 0, 0);
      // 첫 프레임은 버린다 — 텍스처·셰이더 업로드가 섞인다
      g.flashlight.update(1 / 60); g.post.render(1 / 60);
    }, i);
    await new Promise(r => setTimeout(r, 400));
    await page.evaluate(() => {
      window.game.flashlight.update(1 / 60);
      window.game.post.render(1 / 60);
    });

    // 요즘 puppeteer 는 Buffer 가 아니라 Uint8Array 를 준다. pngjs 는 Buffer 를 받는다.
    const buf = Buffer.from(await page.screenshot({ type: 'png' }));
    const { width, height, data } = PNG.sync.read(buf);
    let sum = 0, dark = 0, blown = 0;
    const n = width * height;
    for (let p = 0; p < n; p++) {
      const o = p << 2;
      // sRGB 가중 휘도
      const l = (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]) / 255;
      sum += l;
      if (l < 0.02) dark++;
      if (l > 0.99) blown++;
    }
    stats[ids[i]] = {
      '먹통 %': +(dark / n * 100).toFixed(1),
      '평균 휘도': +(sum / n).toFixed(4),
      '탄 픽셀 %': +(blown / n * 100).toFixed(3),
    };
  }
} finally {
  await browser.close();
  stopServer();
}

console.table(stats);
if (outFile) { fs.writeFileSync(outFile, JSON.stringify(stats, null, 1), 'utf8'); console.log(`저장: ${outFile}`); }

if (cmpFile) {
  const old = JSON.parse(fs.readFileSync(cmpFile, 'utf8'));
  console.log('\n=== 전 → 후 ===');
  for (const k of Object.keys(stats)) {
    if (!old[k]) continue;
    const a = old[k], b = stats[k];
    console.log(`${k.padEnd(15)} 먹통 ${String(a['먹통 %']).padStart(5)}% → ${String(b['먹통 %']).padStart(5)}%` +
      `   평균휘도 ${a['평균 휘도']} → ${b['평균 휘도']}` +
      `   탄픽셀 ${a['탄 픽셀 %']}% → ${b['탄 픽셀 %']}%`);
  }
}
