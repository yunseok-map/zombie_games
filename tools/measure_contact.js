/**
 * measure_contact.js — 공격 클립에서 **팔이 가장 뻗는 순간**을 잰다.
 *
 * 브라우저 콘솔에서:
 *   const { measureContact } = await import('/tools/measure_contact.js');
 *   console.table(measureContact(window.game));
 *
 * 왜 재는가 —
 *   데미지는 "팔이 닿는 프레임"에 들어가야 한다. 그 지점은 클립마다 다르다
 *   (어떤 건 30%, 어떤 건 60%). 눈대중으로 하나를 정하면 나머지가 전부 어긋난다.
 *   결과는 `balance.js` 의 `ATTACK.contact` 에 넣는다.
 *
 * 재는 법 —
 *   개체를 정지시키고 공격 클립을 프레임 단위로 훑으면서, **골반 기준 손목의 전방
 *   도달 거리**가 최대인 시점을 찾는다. 단순 거리로 재면 팔을 머리 위로 드는
 *   예비동작이 최대로 잡힌다 — 그건 닿는 순간이 아니다.
 *
 * 한계: 개체마다 클립을 하나씩만 들고 있으므로(변형 고정), 풀에 있는 개체들이
 *   가진 클립만 측정된다. 못 본 클립은 결과에 안 나온다 — 여러 번 돌려 모아라.
 */

const SAMPLES = 90;              // 클립당 표본 수. 0.5초짜리도 프레임 단위로 잡힌다
// **손만 재면 안 된다.** kicking 은 발이 닿는다. 네 팔다리를 다 재서
// 가장 멀리 뻗는 것을 그 클립의 타격 부위로 본다.
const LIMBS = ['RightHand', 'LeftHand', 'RightFoot', 'LeftFoot'];
const HIPS = 'Hips';

/**
 * 뼈를 이름 **끝**으로 찾는다.
 *
 * **GLTFLoader 는 노드 이름에서 콜론을 지운다** (`PropertyBinding.sanitizeNodeName`).
 * FBX/GLB 안에는 `mixamorig:RightHand` 인데 three.js 씬에서는 `mixamorigRightHand` 다.
 * 파일을 뜯어본 이름 그대로 비교하면 **하나도 못 찾는다** — 실제로 그랬다.
 * 그래서 영숫자만 남기고 접미사로 맞춘다. `RightHandIndex1` 같은 자식 뼈가 걸리지
 * 않도록 **정확히 그 이름으로 끝나는 것**만 받는다.
 */
function findBone(root, suffix) {
  let hit = null;
  root.traverse((o) => {
    if (hit || !o.isBone) return;
    const n = (o.name || '').replace(/[^A-Za-z0-9]/g, '');
    if (n.endsWith(suffix)) hit = o;
  });
  return hit;
}

/**
 * 개체 하나에서 지금 물려 있는 공격 클립의 접촉 지점을 잰다.
 * 개체의 자세·상태를 건드리므로 **측정 전용 세션에서만** 쓴다.
 */
function measureOne(z) {
  const action = z.actions?.attack;
  if (!action || !z.model || !z.mixer) return null;
  const clip = action.getClip();
  const limbs = LIMBS.map((n) => [n, findBone(z.model, n)]).filter(([, b]) => b);
  const hand = limbs.length ? limbs[0][1] : null;
  const hips = findBone(z.model, HIPS);
  if (!hand || !hips) {
    // 못 찾으면 **어떤 이름들이 있었는지 같이 돌려준다.** 안 그러면 왜 실패했는지 모른다
    const names = [];
    z.model.traverse((o) => { if (o.isBone && names.length < 12) names.push(o.name); });
    return { name: clip.name, error: `뼈를 못 찾음 (있는 이름: ${names.join(', ')})` };
  }

  // 방향을 고정한다. group.rotation.y = 0 이면 캐릭터는 월드 -Z 를 본다
  // (Zombie.js 의 MODEL_YAW 규약). 그래야 "전방"이 -Z 로 단순해진다.
  const savedRot = z.group.rotation.y;
  const savedActs = [];
  z.mixer.stopAllAction();
  z.group.rotation.y = 0;

  action.reset().play();
  action.timeScale = 0;          // 시간은 우리가 직접 넣는다
  action.setEffectiveWeight(1);

  let best = 0, bestReach = -Infinity, bestLimb = '';
  const curve = [];
  const V = hips.position.constructor;
  for (let i = 0; i < SAMPLES; i++) {
    const f = i / (SAMPLES - 1);
    action.time = f * clip.duration;
    z.mixer.update(0);                    // 자세만 갱신
    z.group.updateMatrixWorld(true);
    const p = hips.getWorldPosition(new V());
    let frameBest = -Infinity, frameLimb = '';
    for (const [n, b] of limbs) {
      const h = b.getWorldPosition(new V());
      // 전방(-Z) 도달 거리. 위로 드는 예비동작은 여기에 안 잡힌다.
      const reach = -(h.z - p.z);
      if (reach > frameBest) { frameBest = reach; frameLimb = n; }
    }
    curve.push(+frameBest.toFixed(3));
    if (frameBest > bestReach) { bestReach = frameBest; best = f; bestLimb = frameLimb; }
  }

  z.group.rotation.y = savedRot;
  action.timeScale = 1;
  savedActs.forEach((a) => a.play());
  return { name: clip.name, contact: +best.toFixed(3), reach: +bestReach.toFixed(3), limb: bestLimb, curve };
}

/** 풀에 있는 개체들을 훑어 클립 이름별로 접촉 지점을 모은다 */
export function measureContact(game) {
  const seen = new Map();
  for (const z of game.pool.all) {
    if (!z.model || !z.actions?.attack) continue;
    const name = z.actions.attack.getClip().name;
    if (seen.has(name)) continue;
    const r = measureOne(z);
    if (r) seen.set(name, r);
  }
  return [...seen.values()].map(({ curve, ...rest }) => rest);
}

/**
 * 걷기·달리기 클립의 **원래 속도**를 잰다 (m/s).
 *
 * 왜 필요한가 —
 *   변환할 때 루트 이동을 지웠으므로 클립 자체는 제자리걸음이다. 그래서 게임은
 *   좀비를 코드로 옮기는데, **클립이 원래 상정한 속도**와 실제 이동 속도가 다르면
 *   발이 미끄러진다. `Zombie._updateAnim` 은 배속을 `실제속도 / 설계속도` 로 잡는데,
 *   이건 **설계속도가 클립의 원래 속도와 같을 때만** 맞는 식이다. 그 전제를 확인한다.
 *
 * 재는 법 —
 *   골반 기준 발의 앞뒤 좌표 진폭이 보폭(S)이다. 한 사이클에 두 걸음이 나가므로
 *   원래 속도 = 2S / 클립길이.
 */
export function measureStride(game) {
  const out = [];
  const seen = new Set();
  for (const z of game.pool.all) {
    if (!z.model || !z.mixer) continue;
    for (const key of ['walk', 'run']) {
      const action = z.actions?.[key];
      if (!action) continue;
      const clip = action.getClip();
      if (seen.has(clip.name)) continue;
      seen.add(clip.name);

      const hips = findBone(z.model, HIPS);
      const feet = ['RightFoot', 'LeftFoot'].map((n) => findBone(z.model, n)).filter(Boolean);
      if (!hips || feet.length < 2) continue;

      const savedRot = z.group.rotation.y;
      z.mixer.stopAllAction();
      z.group.rotation.y = 0;
      action.reset().play();
      action.timeScale = 0;
      const V = hips.position.constructor;

      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < SAMPLES; i++) {
        action.time = (i / (SAMPLES - 1)) * clip.duration;
        z.mixer.update(0);
        z.group.updateMatrixWorld(true);
        const p = hips.getWorldPosition(new V());
        for (const f of feet) {
          const w = f.getWorldPosition(new V());
          const fore = -(w.z - p.z);          // 전방(-Z) 성분
          if (fore < lo) lo = fore;
          if (fore > hi) hi = fore;
        }
      }
      z.group.rotation.y = savedRot;
      action.timeScale = 1;

      const stride = hi - lo;                  // 보폭
      const natural = (2 * stride) / clip.duration;
      out.push({
        key,
        name: clip.name,
        길이: +clip.duration.toFixed(2),
        보폭: +stride.toFixed(3),
        원래속도: +natural.toFixed(2),
        설계속도: key === 'run' ? z.def.speedChase : z.def.speedWander,
        배속필요: +(((key === 'run' ? z.def.speedChase : z.def.speedWander)) / natural).toFixed(2),
      });
    }
  }
  return out;
}

/** 곡선까지 같이 보고 싶을 때 */
export function measureContactFull(game) {
  const seen = new Map();
  for (const z of game.pool.all) {
    if (!z.model || !z.actions?.attack) continue;
    const name = z.actions.attack.getClip().name;
    if (!seen.has(name)) seen.set(name, measureOne(z));
  }
  return [...seen.values()];
}
