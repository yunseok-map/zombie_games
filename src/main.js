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
Promise.all([preloadZombieModel(), preloadWeaponModels(), propModels.preload()]).finally(() => {
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
document.getElementById('btn-retry').addEventListener('click', begin);
document.getElementById('btn-resume').addEventListener('click', () => game.resume());

// 개발 중 디버그: 콘솔에서 game 접근
window.game = game;
