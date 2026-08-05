/**
 * qa_motion.js — 좀비 모션을 **프레임 단위로 끊어서** 검사한다.
 *
 * 어두운 화면에서 눈으로는 절대 못 찾는 것들이 있다:
 *   - 발이 바닥을 뚫고 내려간다 (뼈 월드 Y < 0)
 *   - 몸이 공중에 떠 있다 (가장 낮은 뼈가 바닥에서 멀다)
 *   - 발이 미끄러진다 (이동 속도와 클립 재생 속도가 안 맞는다)
 *   - 재생 속도가 극단이다 (0.4 미만 = 늘어짐, 2.5 초과 = 경련)
 *
 * 브라우저 콘솔에서:
 *   const { runMotionQA, summarize } = await import('/tools/qa_motion.js');
 *   console.log(summarize(await runMotionQA(window.game)));
 *   console.table((await runMotionQA(window.game)).frames.filter(f => f.문제));
 *
 * 게임 루프를 멈추지 않는다 — pool.update 를 직접 돌려서 프레임을 만든다.
 * (탭이 백그라운드면 requestAnimationFrame 이 안 도는데, 이 도구는 그것과 무관하다)
 */

import * as THREE from 'three';
import { ZOMBIE, CORPSE } from '../src/config/balance.js';

const DT = 1 / 60;

/** 바닥 기준 허용치(m). 이보다 아래면 뚫린 것, 이보다 위면 뜬 것 */
const TOL_BELOW = -0.04;
const TOL_ABOVE = 0.28;

const _v = new THREE.Vector3();

/**
 * 지금 자세에서 가장 낮은 뼈의 월드 Y.
 *
 * **`modelYOffset` 은 되돌려서 잰다.** 포복체는 뼈가 메시의 보이는 바닥과 어긋난
 * 리그를 쓰기 때문에 모델을 통째로 62cm 내려서 맞춰 놓았다. 그 상태의 월드 좌표를
 * 그대로 재면 "62cm 뚫렸다"가 나오는데, 화면으로 보면 멀쩡히 엎드려 있다.
 * 즉 오프셋은 이미 적용된 보정이므로 판정에서 제외해야 한다.
 */
function lowestBoneY(z, motion) {
  if (!z.model) return null;
  z.group.updateMatrixWorld(true);
  let lo = Infinity;
  z.model.traverse((o) => {
    if (!o.isBone) return;
    o.getWorldPosition(_v);
    if (_v.y < lo) lo = _v.y;
  });
  if (!Number.isFinite(lo)) return null;
  // 사망은 Zombie 가 이미 "가장 낮은 뼈를 restHeight 에 맞추는" 스냅을 돌린다.
  // 거기서 오프셋을 또 빼면 이중 보정이 되어 멀쩡한 시체가 떠 있다고 나온다.
  if (motion === '사망') return lo;
  return lo - (z.def?.modelYOffset ?? 0);
}

/**
 * 한 동작을 프레임 단위로 훑는다.
 * @param setup (z) => void   그 동작에 들어가게 만드는 함수
 * @param frames 몇 프레임을 볼 것인가
 */
function probe(game, typeKey, motion, setup, frames) {
  const p = game.player;
  game.pool.despawnAll();
  const z = game.pool.spawn(typeKey, p.pos.x + 3.5, p.pos.z + 3.5);
  if (!z) return [];
  setup(z, p);

  const ctx = { player: p, collision: game.collision, detectionMul: 1 };
  const out = [];
  for (let i = 0; i <= frames; i++) {
    game.pool.update(DT, ctx);
    const lo = lowestBoneY(z, motion);
    const act = z.curAnim;
    const row = {
      타입: ZOMBIE[typeKey]?.label ?? typeKey,
      동작: motion,
      f: i,
      t: +(i * DT).toFixed(2),
      클립: act?.getClip?.().name ?? '—',
      배속: act ? +act.timeScale.toFixed(2) : null,
      최저뼈Y: lo == null ? null : +lo.toFixed(3),
      groupY: +z.group.position.y.toFixed(3),
      이동속도: +(z._moveSpeed ?? 0).toFixed(2),
    };
    row.문제 = diagnose(row, motion, !!z.def?.modelYOffset);
    out.push(row);
  }
  game.pool.despawnAll();
  return out;
}

function diagnose(row, motion, offsetTuned) {
  const bad = [];
  if (row.최저뼈Y != null) {
    // 위쪽 허용치: 죽는 중에는 몸이 넘어가느라 잠깐 뜨는 게 정상이다.
    // 그리고 modelYOffset 으로 눈으로 맞춘 타입(포복체)은 그 오프셋이 **클립 평균**에
    // 맞춰져 있어서, 한 주기 안에서 골반이 오르내리는 만큼 값이 흔들린다.
    // 여기서 좁게 잡으면 화면상 멀쩡한 것을 계속 결함이라고 외친다.
    // 몸을 젖히는 동작(사망·비명)은 발뒤꿈치가 뜨는 것이 정상이다 — 좁게 잡으면
    // 클립이 의도한 자세를 계속 결함이라고 외친다
    const rearing = motion === '사망' || /^(scream|death)/.test(row.클립 ?? '');
    const above = rearing ? TOL_ABOVE * 2.2
      : offsetTuned ? TOL_ABOVE * 3.4
        : TOL_ABOVE;
    const below = offsetTuned ? TOL_BELOW * 4 : TOL_BELOW;
    if (row.최저뼈Y < below) bad.push(`바닥뚫림 ${row.최저뼈Y}m`);
    else if (row.최저뼈Y > above) bad.push(`공중 ${row.최저뼈Y}m`);
  }
  if (row.배속 != null) {
    if (row.배속 < 0.4) bad.push(`늘어짐 x${row.배속}`);
    if (row.배속 > 2.5) bad.push(`경련 x${row.배속}`);
  }
  return bad.length ? bad.join(' · ') : null;
}

/** 전 종류 × 전 동작 */
export async function runMotionQA(game, { types = ['shambler', 'listener', 'crawler'] } = {}) {
  const frames = [];
  for (const t of types) {
    // 배회 — 가만히 걷는다
    frames.push(...probe(game, t, '배회', () => {}, 90));

    // 추격 — 플레이어를 향해 달린다
    frames.push(...probe(game, t, '추격', (z) => z._startChase(), 90));

    // 피격 — 맞고 움찔한다
    frames.push(...probe(game, t, '피격', (z, p) => {
      z._startChase();
      z.hit(5, 1.4, false, p.pos);
    }, 70));

    // 사망 — 쓰러져서 바닥에 눕는다
    frames.push(...probe(game, t, '사망', (z, p) => z.hit(9999, 0, false, p.pos),
      Math.ceil((CORPSE.linger > 4 ? 4 : CORPSE.linger) / DT)));
  }
  return { frames, at: new Date().toISOString() };
}

export function summarize(res) {
  const bad = res.frames.filter((f) => f.문제);
  const byMotion = {};
  for (const f of bad) {
    const k = `${f.타입} / ${f.동작}`;
    (byMotion[k] ??= []).push(`f${f.f} ${f.문제}`);
  }
  return {
    총프레임: res.frames.length,
    문제프레임: bad.length,
    // 동작별로 첫 3개만 — 전부 찍으면 콘솔이 넘친다
    문제: Object.fromEntries(Object.entries(byMotion).map(([k, v]) => [k, v.slice(0, 3)])),
  };
}
