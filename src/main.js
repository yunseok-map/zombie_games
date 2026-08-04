/**
 * main.js — 부트스트랩만. 게임 로직을 여기에 넣지 마라. (CLAUDE.md §4)
 */
import { Game } from './core/Game.js';
import { preloadZombieModel } from './enemies/ZombieModel.js';

const canvas = document.getElementById('app');
const game = new Game(canvas);

const title = document.getElementById('title');
const over = document.getElementById('over');
const pause = document.getElementById('pause');
const loading = document.getElementById('loading');

// 좀비 모델을 먼저 받는다. 없이 시작하면 첫 스폰이 캡슐로 나온다.
const startBtn = document.getElementById('btn-start');
startBtn.disabled = true;
preloadZombieModel().finally(() => {
  loading.classList.add('hide');
  startBtn.disabled = false;
});

async function begin() {
  title.classList.add('hide');
  over.classList.add('hide');
  pause.classList.add('hide');
  await game.start();     // 사용자 클릭 안에서 오디오를 초기화해야 한다
}

document.getElementById('btn-start').addEventListener('click', begin);
document.getElementById('btn-retry').addEventListener('click', begin);
document.getElementById('btn-resume').addEventListener('click', () => game.resume());

// 개발 중 디버그: 콘솔에서 game 접근
window.game = game;
