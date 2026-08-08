/**
 * qa_swing.mjs — 근접 스윙을 **프레임 단위로 재서 수치로 낸다.**
 *
 *   node tools/qa_swing.mjs [저장.json] [비교.json]
 *
 * 필요한 것:  npm i --no-save puppeteer-core
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────
 * "타격이 밋밋하다"는 감각이라 감으로 고치면 끝이 없다. 재야 할 것은 셋이다.
 *
 *   1. **진폭** — 무기가 실제로 얼마나 움직이는가 (회전 rad, 이동 m)
 *   2. **속도** — 가장 빠른 순간의 각속도 (rad/s). 밋밋함의 정체는 대개 이것이다.
 *      진폭이 같아도 천천히 움직이면 휘두르는 게 아니라 미는 것으로 보인다.
 *   3. **접촉 시점의 자세** — 피가 튀는 그 프레임에 무기가 어디에 있는가.
 *      쉬는 자세에서 데미지가 들어가면 무슨 짓을 해도 밋밋하다.
 *
 * 카메라도 같이 잰다. 스윙에 시점이 전혀 안 따라가면 "손만 움직이는 유령"이 된다.
 *
 * 렌더링은 안 한다 — 헤드리스 SwiftShader 는 1fps 라 의미가 없다. 대신 게임을
 * PAUSED 로 두고 뷰모델 갱신만 **고정 dt** 로 직접 돌린다.
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
const PORT = 5197;
const URL = `http://127.0.0.1:${PORT}/`;

const outFile = process.argv[2];
const cmpFile = process.argv[3];

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

let result;
try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => { const b = document.getElementById('btn-start'); return b && !b.disabled; },
    { timeout: 300000, polling: 500 });
  await page.click('#btn-start');
  await page.waitForFunction(() => window.game?.weapons && window.game.stages?.length > 0,
    { timeout: 120000, polling: 200 });
  await page.evaluate(() => { window.game.state = 'PAUSED'; });

  result = await page.evaluate(() => {
    const g = window.game, W = g.weapons, DT = 1 / 120;   // 120Hz 로 재야 피크를 안 놓친다
    const cam = g.camera;
    const out = {};

    const probe = (label) => {
      const def = W.current;
      if (!def || def.type === 'gun') return null;
      // 카메라 기준자세를 기록해 두고 변화량만 본다
      const cam0 = { x: cam.rotation.x, y: cam.rotation.y, z: cam.rotation.z };
      W._swingMelee(def);
      const frames = [];
      let t = 0;
      for (let i = 0; i < 120 && t <= (W._swingDur ?? 0.6) + 0.05; i++) {
        W._animateViewModel(DT, null);
        // 카메라는 Player 가 조립한다. 이걸 안 부르면 스윙이 시점에 주는 기울기가
        // 반영되지 않아 **카메라 진폭이 늘 0 으로 나온다** (한 번 그렇게 오독했다).
        g.player._syncCamera(DT);
        t += DT;
        const R = W.viewRoot;
        frames.push({
          t: +t.toFixed(4),
          rx: R.rotation.x, ry: R.rotation.y, rz: R.rotation.z,
          px: R.position.x, py: R.position.y, pz: R.position.z,
          arc: W._swing ?? 0,
          camx: cam.rotation.x - cam0.x, camy: cam.rotation.y - cam0.y, camz: cam.rotation.z - cam0.z,
        });
      }
      // 각속도 — 프레임 사이 회전 변화량의 크기
      let peakW = 0, peakWt = 0;
      for (let i = 1; i < frames.length; i++) {
        const a = frames[i - 1], b = frames[i];
        const w = Math.hypot(b.rx - a.rx, b.ry - a.ry, b.rz - a.rz) / DT;
        if (w > peakW) { peakW = w; peakWt = b.t; }
      }
      const span = k => {
        const v = frames.map(f => f[k]);
        return +(Math.max(...v) - Math.min(...v)).toFixed(4);
      };
      const contactT = Math.min((W._swingDur ?? 0.6) * 0.46, 0.30);
      const at = frames.reduce((best, f) =>
        Math.abs(f.t - contactT) < Math.abs(best.t - contactT) ? f : best, frames[0]);
      return {
        스윙길이: +(W._swingDur ?? 0).toFixed(3),
        회전진폭_rad: { x: span('rx'), y: span('ry'), z: span('rz') },
        이동진폭_m: { x: span('px'), y: span('py'), z: span('pz') },
        최대각속도_rad_s: +peakW.toFixed(2),
        최대각속도_시각: +peakWt.toFixed(3),
        카메라진폭_rad: { x: span('camx'), y: span('camy'), z: span('camz') },
        접촉시각: +contactT.toFixed(3),
        접촉시_궤적값: +at.arc.toFixed(3),
        접촉시_회전x: +at.rx.toFixed(3),
        프레임: frames.length,
      };
    };

    // 지금 든 무기로 한 번
    out[W.current?.id ?? 'current'] = probe();
    // 다른 근접 무기가 있으면 바꿔 가며
    for (let slot = 1; slot <= 3; slot++) {
      try {
        W.switchTo(slot);
        const id = W.current?.id;
        if (id && !out[id] && W.current.type !== 'gun') out[id] = probe();
      } catch {}
    }
    return out;
  });
} finally {
  await browser.close();
  stopServer();
}

const rows = [];
for (const [id, r] of Object.entries(result)) {
  if (!r) continue;
  rows.push({
    무기: id,
    '스윙(초)': r.스윙길이,
    '회전진폭 x': r.회전진폭_rad.x,
    '회전진폭 z': r.회전진폭_rad.z,
    '최대각속도': r.최대각속도_rad_s,
    '카메라 x': r.카메라진폭_rad.x,
    '카메라 z': r.카메라진폭_rad.z,
    '접촉시 궤적': r.접촉시_궤적값,
  });
}
console.table(rows);

if (outFile) { fs.writeFileSync(outFile, JSON.stringify(result, null, 1), 'utf8'); console.log(`저장: ${outFile}`); }

if (cmpFile) {
  const old = JSON.parse(fs.readFileSync(cmpFile, 'utf8'));
  console.log('\n=== 전 → 후 ===');
  for (const id of Object.keys(result)) {
    const a = old[id], b = result[id];
    if (!a || !b) continue;
    const pct = (x, y) => (x === 0 ? '—' : ((y - x) / Math.abs(x) * 100).toFixed(0) + '%');
    console.log(`\n${id}`);
    console.log(`  회전진폭 x     ${a.회전진폭_rad.x} → ${b.회전진폭_rad.x}   (${pct(a.회전진폭_rad.x, b.회전진폭_rad.x)})`);
    console.log(`  회전진폭 z     ${a.회전진폭_rad.z} → ${b.회전진폭_rad.z}   (${pct(a.회전진폭_rad.z, b.회전진폭_rad.z)})`);
    console.log(`  최대각속도     ${a.최대각속도_rad_s} → ${b.최대각속도_rad_s} rad/s   (${pct(a.최대각속도_rad_s, b.최대각속도_rad_s)})`);
    console.log(`  카메라 진폭 x  ${a.카메라진폭_rad.x} → ${b.카메라진폭_rad.x}`);
    console.log(`  카메라 진폭 z  ${a.카메라진폭_rad.z} → ${b.카메라진폭_rad.z}`);
    console.log(`  접촉시 궤적값  ${a.접촉시_궤적값} → ${b.접촉시_궤적값}`);
  }
}
