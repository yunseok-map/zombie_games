/**
 * check_pdf_layout.mjs — 뽑은 PDF 를 실제로 열어 각 쪽의 하단 여백을 잰다.
 *
 *   node tools/check_pdf_layout.mjs [쪽번호...]     # 쪽번호를 주면 PNG 로도 저장
 *
 * 필요한 것:  npm i --no-save pdf-to-img pngjs
 *
 * 왜 필요한가
 *   `break-inside:avoid` 가 걸린 표·그림이 쪽 경계에 걸리면 통째로 다음 쪽으로 밀려서
 *   앞 쪽 하단이 크게 빈다. 한 쪽만 눈으로 보면 우연인지 전반적인지 구분이 안 된다.
 *   전 쪽을 훑어 "마지막 잉크가 찍힌 높이"를 백분율로 낸다.
 *
 *   **마지막 쪽이 비는 것은 문서 끝이라 정상이다** — 판정에서 뺀다.
 */
import { pdf } from 'pdf-to-img';
import { PNG } from 'pngjs';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');
const FILES = ['제출3_게임소개.pdf', '제출4_AI활용기술.pdf'];

const WANT = process.argv.slice(2).map(Number).filter(Boolean);
const SHOTS = path.join(DOCS, 'pdf_pages');
if (WANT.length) await mkdir(SHOTS, { recursive: true });

const LIMIT = 22;   // 하단 22% 이상 비면 눈에 띈다

for (const f of FILES) {
  const doc = await pdf(path.join(DOCS, f), { scale: 0.8 });
  const rows = [];
  const buffers = [];
  for await (const buf of doc) buffers.push(buf);

  buffers.forEach((buf, idx) => {
    const { width, height, data } = PNG.sync.read(buf);
    let lastInk = 0;
    for (let y = 0; y < height; y++) {
      let ink = 0;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) << 2;
        if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) ink++;
      }
      if (ink > width * 0.004) lastInk = y;   // 점 몇 개는 무시
    }
    const tail = ((height - lastInk) / height) * 100;
    const isLast = idx === buffers.length - 1;
    rows.push({
      쪽: idx + 1,
      '하단 여백 %': tail.toFixed(1),
      판정: isLast ? '— (문서 끝)' : tail > LIMIT ? '⚠ 크게 빔' : 'ok',
    });
  });

  console.log(`\n=== ${f} (${buffers.length}쪽) ===`);
  console.table(rows);
  const bad = rows.filter(r => r.판정.startsWith('⚠'));
  console.log(bad.length ? `크게 빈 쪽: ${bad.map(b => b.쪽).join(', ')}` : '크게 빈 쪽 없음');

  for (const n of WANT) {
    if (!buffers[n - 1]) continue;
    const tag = f.startsWith('제출3') ? 'doc3' : 'doc4';
    const p = path.join(SHOTS, `${tag}_p${String(n).padStart(2, '0')}.png`);
    await writeFile(p, buffers[n - 1]);
    console.log(`  저장: ${path.relative(ROOT, p)}`);
  }
}
