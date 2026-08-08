/**
 * main.js — 부트스트랩만. 게임 로직을 여기에 넣지 마라. (CLAUDE.md §4)
 */
import { Game } from './core/Game.js';
import { preloadZombieModel } from './enemies/ZombieModel.js';
import { preloadWeaponModels } from './weapons/ViewModels.js';
import { propModels } from './world/PropModels.js';

const canvas = document.getElementById('app');
const game = new Game(canvas);

const title = document.getElementById('title');
const over = document.getElementById('over');
const pause = document.getElementById('pause');
const loading = document.getElementById('loading');

// 모델을 먼저 받는다. 없이 시작하면 첫 스폰이 캡슐로, 소품이 절차적 상자로 나온다.
// 소품까지 여기서 받는 이유: 시작 화면 배경에 실제 구역을 띄우기 때문이다.
const startBtn = document.getElementById('btn-start');
startBtn.disabled = true;
// 진행 막대 — 글자만 있으면 멈춘 건지 받는 중인지 알 수 없다.
// 각 단계가 끝날 때마다 채운다(파일 단위 진행률은 로더가 안 알려준다).
const fill = document.getElementById('load-fill');
const what = document.getElementById('load-what');
const jobs = [
  ['감염체 자료', preloadZombieModel()],
  ['장비 자료', preloadWeaponModels()],
  ['시설 자료', propModels.preload()],
];
let done = 0;
const step = (label) => {
  done++;
  if (fill) fill.style.transform = `scaleX(${done / jobs.length})`;
  if (what) what.textContent = `${label} 확보 완료`;
};
Promise.all(jobs.map(([label, p]) => p.finally(() => step(label)))).finally(() => {
  loading.classList.add('hide');
  startBtn.disabled = false;
  game.startAttract();          // 타이틀 뒤에서 복도가 살아 움직인다
});

async function begin() {
  title.classList.add('hide');
  over.classList.add('hide');
  pause.classList.add('hide');
  await game.start();     // 사용자 클릭 안에서 오디오를 초기화해야 한다
}

/** 사망 화면에서. start() 는 에셋 프리로드까지 다시 하므로 두 번째부터는 restart 만 부른다 */
function beginFrom(fromCheckpoint) {
  over.classList.add('hide');
  pause.classList.add('hide');
  game.restart(fromCheckpoint);
}

// 크레딧 — 외부 에셋이 CC Attribution 계열이라 제작자 표기가 의무다 (ASSETS.md §4-B)
const credits = document.getElementById('credits');
document.getElementById('btn-credits').addEventListener('click', () => {
  title.classList.add('hide');
  credits.classList.remove('hide');
});
document.getElementById('btn-credits-back').addEventListener('click', () => {
  credits.classList.add('hide');
  title.classList.remove('hide');
});

document.getElementById('btn-start').addEventListener('click', begin);
// 사망 후 — 마지막으로 도달한 구역부터가 기본이다. 5구역을 매번 다시 걷게 하면 끝을 못 본다
document.getElementById('btn-retry').addEventListener('click', () => beginFrom(true));
document.getElementById('btn-restart').addEventListener('click', () => beginFrom(false));
document.getElementById('btn-resume').addEventListener('click', () => game.resume());

/**
 * 검증 훅. **디버그 편의가 아니라 계약이다** — `tools/` 의 자동 검사가 전부 이걸로 붙는다.
 * (구역 125항목 · 모션 1482프레임 · 전투 경로 · 밝기 · 지오메트리 지문)
 *
 * 헤드리스 크롬은 소프트웨어 렌더라 이 게임이 1fps 로 돌아서, 실제 플레이로는
 * 검사를 할 수가 없다. 그래서 하네스는 `game.state = 'PAUSED'` 로 세운 뒤
 * 고정 dt 로 직접 돌린다. 이 참조를 지우면 CI 의 QA 게이트가 통째로 멈춘다.
 */
window.game = game;
