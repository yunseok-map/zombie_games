/**
 * check_audio.mjs — 소리가 **실제로 게임에 있는지** 세 방향으로 대조한다.
 *
 *   node tools/check_audio.mjs
 *
 * 이 프로젝트에서 두 번 반복된 사고가 있다 (PROGRESS.md 함정):
 *   · `zombie_notice.mp3` — AudioManager 에 **등록만 되고** 두 세션 동안 한 번도 안 울렸다
 *   · `melee_hit` — 같은 이유로 소방도끼와 쇠파이프가 완전히 같은 소리를 냈다
 * 등록·파일·호출은 셋이 다 있어야 소리가 난다. 하나라도 어긋나면 조용히 없는 것이 된다.
 *
 * 그래서 세 집합을 만들어 서로 뺀다.
 *   A 등록  = AudioManager 의 이름 → 경로 표
 *   B 파일  = public/assets/audio 아래 실제 mp3
 *   C 호출  = 소스에서 `name: '...'` 으로 재생을 거는 곳
 *
 *   A - B  등록했는데 파일이 없다     → 재생 시 조용히 실패한다
 *   B - A  파일은 있는데 등록이 없다   → 그냥 안 쓰이는 파일 (경고만)
 *   A - C  등록했는데 부르는 곳이 없다 → **게임에 없는 것과 같다**
 *   C - A  부르는데 등록이 없다        → 그 순간 무음. 가장 위험하다
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIO_DIR = path.join(ROOT, 'public', 'assets', 'audio');

// ── A. 등록 ──
const amSrc = fs.readFileSync(path.join(ROOT, 'src/core/AudioManager.js'), 'utf8');
const table = amSrc.slice(amSrc.indexOf('{'), amSrc.indexOf('};') + 1);
const registered = new Map();
for (const m of table.matchAll(/^\s*([A-Za-z_][\w]*)\s*:\s*'([^']+)'/gm))
  registered.set(m[1], m[2]);

// ── B. 파일 ──
const files = new Set();
for (const sub of ['sfx', 'ambience']) {
  const d = path.join(AUDIO_DIR, sub);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) if (f.endsWith('.mp3')) files.add(`${sub}/${f}`);
}

// ── C. 호출 ──
// **`name:` 바로 뒤만 보면 안 된다.** 삼항연산자(`cond ? 'a' : \`b_${i}\``)나 변수를
// 거치는 형태를 통째로 놓친다 (한 번 그렇게 만들어 오탐 10건이 나왔다).
// 그래서 소스 전체에서 **모든 문자열 리터럴**과 **템플릿의 앞부분**을 걷는다.
// 이름이 소리 표에만 쓰이는 형태라 이 정도로 충분하고, 놓치는 쪽보다 낫다.
//
// 방향마다 쓰는 집합이 다르다. 한 집합으로 양쪽을 보면 반드시 한쪽이 오탐투성이가 된다.
//   · "등록됐는데 안 쓰이나"  → **넓게** 본다. 소스 어디에도 안 나오면 확실히 죽은 것이다.
//   · "부르는데 등록됐나"    → **좁게** 본다. 넓게 보면 소품 이름·구역 id 까지
//                              소리 이름으로 오해한다 (실제로 206건 나왔다).
const called = new Set();       // 넓게 — 소스의 모든 문자열
const prefixes = new Set();     // 넓게 — 템플릿 앞부분
const played = new Set();       // 좁게 — SFX 재생을 실제로 거는 곳
const playedPrefixes = new Set();

const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!e.name.endsWith('.js')) continue;
    const s = fs.readFileSync(p, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')          // 주석 속 이름은 호출이 아니다
      .replace(/(^|[^:])\/\/.*$/gm, '$1 ');
    for (const m of s.matchAll(/'([a-z0-9_]{3,})'/g)) called.add(m[1]);
    for (const m of s.matchAll(/`([a-z0-9_]{3,})\$\{/g)) prefixes.add(m[1]);

    // 좁은 쪽 — `EV.SFX` 를 거는 emit 한 덩어리 안의 문자열만 본다.
    // 삼항연산자(`a ? 'x' : \`y_${i}\``)도 이 덩어리 안에 들어오므로 같이 잡힌다.
    for (const m of s.matchAll(/EV\.SFX\s*,\s*\{([\s\S]{0,300}?)\}\s*\)/g)) {
      for (const q of m[1].matchAll(/'([a-z0-9_]{3,})'/g)) played.add(q[1]);
      for (const q of m[1].matchAll(/`([a-z0-9_]{3,})\$\{/g)) playedPrefixes.add(q[1]);
    }
  }
};
walk(path.join(ROOT, 'src'));

const covered = (n, set) => [...set].some(p => n.startsWith(p));

const missingFile = [...registered].filter(([, p]) => !files.has(p));
const unregistered = [...files].filter(f => ![...registered.values()].includes(f));
const neverCalled = [...registered.keys()]
  .filter(n => !called.has(n) && !covered(n, prefixes));
// 좁은 집합으로 본다. 접두어로 만들어지는 이름(`hit_blunt_${i}`)은 등록 표에
// 그 접두어로 시작하는 항목이 하나라도 있으면 통과시킨다.
const notRegistered = [...played].filter(n => !registered.has(n))
  .concat([...playedPrefixes].filter(p => ![...registered.keys()].some(n => n.startsWith(p))));

const show = (title, rows, fatal) => {
  if (!rows.length) { console.log(`✅ ${title} — 없음`); return 0; }
  console.log(`${fatal ? '❌' : '⚠ '} ${title} — ${rows.length}건`);
  rows.forEach(r => console.log('     ' + (Array.isArray(r) ? `${r[0]}  →  ${r[1]}` : r)));
  return fatal ? rows.length : 0;
};

let bad = 0;
bad += show('등록했는데 파일이 없다 (재생 시 조용히 실패)', missingFile, true);
bad += show('부르는데 등록이 없다 (그 순간 무음)', notRegistered, true);
bad += show('등록했는데 부르는 곳이 없다 (게임에 없는 것과 같다)', neverCalled, true);
show('파일은 있는데 등록이 없다 (안 쓰는 파일)', unregistered, false);

console.log(`\n등록 ${registered.size} · 파일 ${files.size} · 재생 호출 ${played.size}(+접두어 ${playedPrefixes.size})`);
console.log(bad === 0 ? '✅ 등록·파일·호출이 전부 맞물린다' : `❌ 문제 ${bad}건`);
process.exit(bad === 0 ? 0 : 1);
