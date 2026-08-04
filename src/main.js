/**
 * main.js — 부트스트랩만. 게임 로직을 여기에 넣지 마라. (CLAUDE.md §4)
 */
import { Game } from './core/Game.js';

const canvas = document.getElementById('app');
const game = new Game(canvas);

const title = document.getElementById('title');
const over = document.getElementById('over');
const pause = document.getElementById('pause');
const loading = document.getElementById('loading');

loading.classList.add('hide');

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
