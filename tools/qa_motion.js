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
import { ZOMBIE, CORPSE, ANIM } from '../src/config/balance.js';

const DT = 1 / 60;

/** 바닥 기준 허용치(m). 이보다 아래면 뚫린 것, 이보다 위면 뜬 것 */
const TOL_BELOW = -0.04;
const TOL_ABOVE = 0.28;

/**
 * 사망 중에는 **떠 있는 것이 정상이다** (2026-08-08).
 *
 * 예전에는 접지 보정이 쓰러지는 내내 걸려서 가장 낮은 뼈가 항상 0.06 이었다.
 * 그래서 이 검사는 사망 프레임을 사실상 안 보고 지나갔다. 그런데 그 붙박임 자체가
 * 결함이었다 — 몸이 떨어지는 대신 가장 낮은 팔다리를 축으로 공중에서 돌았다
 * (PROGRESS.md "시체가 공중에서 도는 것"). 지금은 시간으로 가속해 내려온다.
 *
 * 그래서 쓰러지는 1.85초 동안은 뜨는 것이 맞다. 다섯 층 x 네 종류 실측 최대가
 * 0.77m 였으므로 0.28 x 3.4 = 0.95m 로 잡는다. 넘으면 그건 낙하가 아니라 부양이다.
 * **다 쓰러진 뒤의 접지**는 이 검사가 아니라 `scratchpad/qa/walk_audit.mjs` 가 본다
 * (층마다 네 종류를 죽여 4초 뒤 가장 낮은 뼈를 잰다 — 20/20 이 0.06).
 */
const FALL_ABOVE_MUL = 3.4;

/**
 * 넉백으로 몸이 젖혀질 때(KNOCK.bend) 발이 내려가는 만큼은 빼고 본다.
 *
 * Zombie 는 피격 중 group 을 통째로 기울인다. 회전축이 발치라서, 축에서 옆으로
 * 떨어진 뼈는 기운 각도만큼 바닥 아래로 내려간다 — 클립이나 리그 결함이 아니라
 * **의도한 연출의 기하학적 결과**다. 고정 허용치로 재면 이걸 계속 결함이라고 외친다.
 *   실측: 기울기 0.26rad 에서 4.1~4.8cm. sin(0.26) x 0.19m 과 일치한다.
 * 그래서 상수를 늘리는 대신 **그 순간의 실제 기울기에서 허용치를 만든다.**
 */
const TILT_REACH = 0.22;   // 회전축에서 가장 낮은 뼈까지의 수평 거리(m). 실측 0.19 + 여유

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
  // 사망은 Zombie 가 접지 높이를 직접 물린다(다 쓰러진 뒤 restHeight, 쓰러지는 중에는
  // 거기까지 가속해 내려온다). 여기서 오프셋을 또 빼면 이중 보정이 되어
  // 멀쩡한 시체가 떠 있다고 나온다. 쓰러지는 중의 허용치는 FALL_ABOVE_MUL 을 본다.
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
      // 넉백으로 몸이 기운 정도. 이만큼은 발이 내려가는 게 정상이다 (TILT_REACH 참고)
      기울기: +Math.hypot(Math.sin(z.group.rotation.x), Math.sin(z.group.rotation.z)).toFixed(4),
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
    // 쓰러지는 중은 젖히는 것과 다른 사유다 — 몸이 실제로 공중에 있다 (FALL_ABOVE_MUL)
    const falling = motion === '사망';
    // 두 사유는 **겹칠 수 있다.** 예전에는 삼항으로 하나만 골라서, 오프셋을 맞춘
    // 포복체가 비명 클립에 들어가는 순간 허용치가 0.952 → 0.616 으로 오히려 좁아졌다.
    // 그래서 바닥에 잘 붙어 있는 자세(뼈 7.8cm)를 20회 중 2회꼴로 결함이라고 외쳤다.
    // 둘 다 "더 떠도 정상"인 사유이므로 **느슨한 쪽**을 쓴다.
    const above = TOL_ABOVE * Math.max(
      falling ? FALL_ABOVE_MUL : 1, rearing ? 2.2 : 1, offsetTuned ? 3.4 : 1);
    // 젖혀진 만큼 발이 내려가는 것은 정상이므로 그만큼 허용치를 내린다
    const tiltSag = (row.기울기 ?? 0) * TILT_REACH;
    const below = (offsetTuned ? TOL_BELOW * 4 : TOL_BELOW) - tiltSag;
    if (row.최저뼈Y < below) bad.push(`바닥뚫림 ${row.최저뼈Y}m (기울기 보정 ${below.toFixed(3)})`);
    else if (row.최저뼈Y > above) bad.push(`공중 ${row.최저뼈Y}m`);
  }
  if (row.배속 != null) {
    // **상한을 여기에 적어 두면 안 된다.** 이 검사의 목적은 "미학적으로 빠르다"가 아니라
    // **clamp 가 우회되고 있는가** 다 (지터를 clamp 밖에서 곱해 상한 2.0 에 2.16 이
    // 나오던 결함이 이 검사의 존재 이유다). 그러니 설정값을 그대로 읽어야 한다.
    // 예전에는 2.5 를 박아 놔서, balance.js 의 상한을 올린 순간 멀쩡한 값을 결함이라 외쳤다.
    const lo = (ANIM.moveMinSpeed ?? 0.4) - 1e-6;
    const hi = (ANIM.moveMaxSpeed ?? 2.4) + 1e-6;
    if (row.배속 < lo) bad.push(`늘어짐 x${row.배속} (하한 ${lo.toFixed(2)})`);
    if (row.배속 > hi) bad.push(`배속상한초과 x${row.배속} (상한 ${hi.toFixed(2)})`);
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
