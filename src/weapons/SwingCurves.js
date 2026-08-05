/**
 * SwingCurves — 사람 근접공격 모션에서 뽑아낸 **손 궤적**을 읽어 둔다.
 *
 * 이 게임은 1인칭이고 뷰모델은 무기 하나뿐이라(팔도 몸도 없다) 전신 애니메이션을
 * 그대로 재생할 수 없다. 대신 오른손 뼈가 머리 기준으로 어떻게 움직였는지만 뽑아서
 * 무기를 그 곡선대로 흔든다 — 사인 곡선으로 만든 절차적 스윙과 달리 **사람이 실제로
 * 휘두를 때의 가감속**이 남는다.
 *
 * 곡선은 `tools/extract_swing.py` 가 굽는다. 진폭 1 로 정규화돼 있어서
 * 실제 크기는 `WEAPON_SWING`(balance.js)의 계수가 정한다.
 *
 * **파일이 없어도 게임은 그대로 돌아간다** — 없으면 기존 절차적 스윙으로 떨어진다.
 */

const URL = '/assets/models/swing_curves.json';

let curves = null;
let loading = null;

export function preloadSwingCurves() {
  if (loading) return loading;
  loading = fetch(URL)
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => { curves = j; return j; })
    .catch(() => { curves = null; return null; });   // 없으면 조용히 절차적으로 떨어진다
  return loading;
}

export function getCurve(name) {
  return curves?.[name] ?? null;
}

export function hasCurves() { return !!curves; }

/**
 * 곡선을 t(0~1)에서 읽는다. 표본 사이는 선형 보간한다.
 * @returns {{p:number[], e:number[]}} 위치·회전 오프셋 (정규화된 값)
 */
const _out = { p: [0, 0, 0], e: [0, 0, 0] };
export function sampleCurve(curve, t) {
  if (!curve?.samples?.length) {
    _out.p[0] = _out.p[1] = _out.p[2] = 0;
    _out.e[0] = _out.e[1] = _out.e[2] = 0;
    return _out;
  }
  const s = curve.samples;
  const x = Math.max(0, Math.min(1, t)) * (s.length - 1);
  const i = Math.min(s.length - 2, Math.floor(x));
  const f = x - i;
  const a = s[i], b = s[i + 1];
  for (let k = 0; k < 3; k++) {
    _out.p[k] = a.p[k] + (b.p[k] - a.p[k]) * f;
    _out.e[k] = a.e[k] + (b.e[k] - a.e[k]) * f;
  }
  return _out;
}
