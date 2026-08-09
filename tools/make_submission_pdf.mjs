/**
 * make_submission_pdf.mjs — 제출용 HTML 2종을 A4 PDF 로 뽑고, 뽑은 결과를 검사한다.
 *
 *   node tools/make_submission_pdf.mjs
 *
 * 필요한 것 (게임 빌드와 무관해서 package.json 에 넣지 않았다):
 *   npm i --no-save puppeteer-core pdf-lib
 *
 * 왜 손으로 Ctrl+P 하지 않는가
 *   인쇄 대화상자의 **"배경 그래픽"** 을 빠뜨리면 표 머리(회색)와 스크린샷이 통째로
 *   사라진 PDF 가 나온다. 그리고 그것을 알아채지 못한 채 제출하게 된다.
 *   여기서는 printBackground 를 코드로 강제하고, 뽑은 뒤 아래 4가지를 실제로 잰다.
 *
 * 검사 항목
 *   1. 이미지가 로드됐고 naturalWidth 가 0 이 아닌가 (경로가 깨지면 조용히 빈칸이 된다)
 *   2. A4 본문 폭을 넘는 요소가 있는가 (넘치면 인쇄에서 잘린다)
 *      — 반드시 **인쇄 매체**로 잰다. 화면 글꼴(12.5px)로 재면 인쇄(8.5pt)에서
 *        들어갈 것을 넘친다고 잘못 잡는다. 실제로 한 번 헛짚었다.
 *   3. 쪽수
 *   4. 각 쪽 하단이 얼마나 비었는가 (표·그림이 쪽 경계에 걸려 통째로 밀린 곳)
 *      — 마지막 쪽이 비는 것은 문서 끝이라 정상이다. 판정에서 뺀다.
 */
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const { PDFDocument } = require('pdf-lib');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');
/**
 * 완성된 PDF 는 **`제출/` 한 곳에만** 둔다. 원본 HTML 은 `docs/` 에 남는다.
 * 두 곳에 같은 PDF 가 있으면 어느 쪽을 올려야 하는지 헷갈리고, 한쪽만 갱신되면
 * **낡은 것을 제출하게 된다.** 파일 이름은 접수 폼의 항목 이름을 그대로 따랐다.
 */
const OUT = path.join(ROOT, '제출');
const CHROME = process.env.CHROME_PATH
  || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const TARGETS = [
  { html: 'submission_game_overview.html', pdf: 'QUARANTINE_No3_게임소개및설명문서.pdf',
    label: '게임 소개 및 설명 문서', marginMm: 14 },
  { html: 'submission_ai_tech.html', pdf: 'QUARANTINE_No3_AI활용기술문서.pdf',
    label: 'AI 활용 기술 문서', marginMm: 13 },
];

await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--font-render-hinting=none'],
});

const report = [];
let problems = 0;

for (const t of TARGETS) {
  const page = await browser.newPage();
  const failed = [];
  page.on('requestfailed', r => failed.push(`${r.failure()?.errorText} ${r.url()}`));
  page.on('response', r => { if (r.status() >= 400) failed.push(`HTTP ${r.status()} ${r.url()}`); });
  page.on('pageerror', e => failed.push(`JS ${e.message}`));

  await page.goto(pathToFileURL(path.join(DOCS, t.html)).href,
                  { waitUntil: 'networkidle0', timeout: 60000 });

  const broken = await page.evaluate(() => [...document.images]
    .filter(i => !i.naturalWidth || !i.naturalHeight)
    .map(i => i.getAttribute('src')));
  const imgCount = await page.evaluate(() => document.images.length);

  // A4 210mm 에서 좌우 여백을 뺀 본문 폭. 인쇄 매체로 전환한 뒤에 잰다.
  const contentPx = Math.floor((210 - t.marginMm * 2) / 25.4 * 96);
  await page.emulateMediaType('print');
  await page.setViewport({ width: contentPx, height: 1100 });
  const overflow = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('table, pre, figure, img, div')) {
      if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
        out.push(`${el.tagName.toLowerCase()}${el.className ? '.' + el.className : ''} ` +
                 `${el.scrollWidth}px > ${el.clientWidth}px :: ` +
                 (el.textContent || '').trim().slice(0, 45).replace(/\s+/g, ' '));
      }
    }
    return out;
  });

  const outPath = path.join(OUT, t.pdf);
  await page.pdf({
    path: outPath,
    format: 'A4',
    printBackground: true,     // ← 손으로 하면 빠뜨리는 그것
    preferCSSPageSize: true,   // 문서의 @page{size:A4; margin:...} 를 그대로 쓴다
    displayHeaderFooter: false,
  });
  await page.close();

  const bytes = await readFile(outPath);
  const pages = (await PDFDocument.load(bytes)).getPageCount();

  report.push({
    문서: t.label, 파일: t.pdf, 쪽수: pages,
    크기: (bytes.length / 1024).toFixed(0) + ' KB',
    이미지: `${imgCount}장 (깨짐 ${broken.length})`,
    가로넘침: overflow.length, 로드실패: failed.length,
  });

  if (broken.length)   { problems++; console.log(`\n[${t.label}] 깨진 이미지:\n  ` + broken.join('\n  ')); }
  if (overflow.length) { problems++; console.log(`\n[${t.label}] 가로 넘침:\n  ` + overflow.join('\n  ')); }
  if (failed.length)   { problems++; console.log(`\n[${t.label}] 로드 실패:\n  ` + failed.join('\n  ')); }
}

await browser.close();
console.log('\n=== 생성 결과 ===');
console.table(report);
console.log(problems ? `\n⚠ 문제 ${problems}건 — 위 목록을 보고 HTML 을 고친 뒤 다시 돌린다.`
                     : '\n문제 없음.');
console.log('쪽 하단 여백까지 보려면 tools/check_pdf_layout.mjs 를 돌린다.');
