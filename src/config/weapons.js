/**
 * weapons.js — 무기 정의. 데이터만 추가하면 무기가 늘어난다. 코드 수정 불필요.
 *
 * type: 'melee' | 'gun' | 'throw'
 * 공통: id, label, type, slot(1=근접 2=총기 3=투척), damage, cooldown, noise
 * melee 전용 : range, arcDeg, stun, blade(날붙이면 true — 타격음이 달라진다)
 * gun   전용 : magSize, reloadTime, spread, pellets, reloadPerShell, silenced
 * throw 전용 : radius, fuse, lure(유인용이면 true)
 */

export const WEAPONS = {
  // ─────────── 근접: 둔기 ───────────
  pipe: {
    id: 'pipe', label: '쇠파이프', type: 'melee', slot: 1,
    damage: 26, cooldown: 0.52, range: 2.0, arcDeg: 70,
    stun: 1.4, noise: 'melee', viewColor: 0x8a8d90, viewScale: [0.05, 0.05, 1.0],
  },
  crowbar: {
    // 쇠파이프보다 무겁고 느리지만 한 방이 크다. 기절이 길어 한 마리씩 처리하기 좋다.
    id: 'crowbar', label: '쇠지렛대', type: 'melee', slot: 1,
    damage: 34, cooldown: 0.68, range: 2.1, arcDeg: 60,
    stun: 1.8, noise: 'melee', viewColor: 0x6f7276, viewScale: [0.05, 0.05, 1.05],
  },
  extinguisher: {
    id: 'extinguisher', label: '소화기', type: 'melee', slot: 1,
    damage: 40, cooldown: 1.0, range: 1.9, arcDeg: 90,
    stun: 2.2, noise: 'melee', viewColor: 0x9c2b22, viewScale: [0.16, 0.42, 0.16],
  },

  // ─────────── 근접: 날붙이 ───────────
  axe: {
    id: 'axe', label: '소방도끼', type: 'melee', slot: 1, blade: true,
    damage: 55, cooldown: 0.85, range: 2.2, arcDeg: 55,
    stun: 0.6, noise: 'melee', viewColor: 0xb0402f, viewScale: [0.07, 0.07, 0.95],
  },
  bonesaw: {
    id: 'bonesaw', label: '수술용 절단기', type: 'melee', slot: 1, blade: true,
    damage: 22, cooldown: 0.3, range: 1.5, arcDeg: 45,
    stun: 0.25, noise: 'melee', viewColor: 0xc8ccd0, viewScale: [0.04, 0.12, 0.5],
  },

  // ─────────── 총기 ───────────
  pistol: {
    id: 'pistol', label: '9mm 권총', type: 'gun', slot: 2,
    damage: 34, cooldown: 0.28, magSize: 12, reloadTime: 1.6,
    spread: 0.012, pellets: 1, range: 60, noise: 'gunshot',
    viewColor: 0x2a2c2e, viewScale: [0.06, 0.13, 0.24],
  },
  shotgun: {
    id: 'shotgun', label: '산탄총', type: 'gun', slot: 2,
    damage: 20, cooldown: 0.9, magSize: 6, reloadTime: 0.55, reloadPerShell: true,
    spread: 0.075, pellets: 7, range: 22, noise: 'gunshot',
    viewColor: 0x3b2f28, viewScale: [0.07, 0.09, 0.9],
  },
  nailgun: {
    id: 'nailgun', label: '못총', type: 'gun', slot: 2,
    damage: 26, cooldown: 0.42, magSize: 20, reloadTime: 2.1,
    spread: 0.02, pellets: 1, range: 30,
    noise: 'gunshotSilenced', silenced: true,   // 조용한 총 — 전략 무기
    viewColor: 0xc9a227, viewScale: [0.08, 0.16, 0.3],
  },

  // ─────────── 투척 ───────────
  /**
   * 화염병 — 한 번 컷했다가 되살렸다 (2026-08-08).
   *
   * 컷한 이유는 이랬다: 정의·뷰모델은 있었지만 던지면 **9m 앞에 즉시 보이지 않는
   * 광역 피해**가 생길 뿐이었다. 병이 날아가지도, 벽에 막히지도, 불이 보이지도 않았다.
   * 그때 남긴 조건이 "투사체·불꽃·화상 셋을 다 넣어라"였고, 셋 다 들어와서 되살렸다
   * (`weapons/Throwables.js`).
   *
   * **피해 수치가 여기 없는 이유** — 불웅덩이는 던진 뒤 8초를 혼자 산다. 반경·초당
   * 피해·타는 시간은 무기가 아니라 그 웅덩이의 성질이라 `balance.js` 의 `FIRE` 에 있다.
   */
  molotov: {
    id: 'molotov', label: '화염병', type: 'throw', slot: 3,
    charges: 2,
    // 주웠을 때 한 번 띄우는 설명. **이게 없으면 플레이어가 용도를 모른다** —
    // 던지는 무기는 아이콘만 봐서는 무슨 일이 일어나는지 알 수 없다.
    usage: '던지면 깨지면서 불바다가 된다 — 좁은 길목을 잠글 때 쓴다',              // 라디오(3)보다 귀하다. 이건 지형을 잠그는 결정타다
    cooldown: 1.2,
    noise: 'interact',
    viewColor: 0x2c4a2e, viewScale: [0.1, 0.24, 0.1],
  },
  radio: {
    id: 'radio', label: '라디오', type: 'throw', slot: 3,
    // 개수가 있어야 도구가 된다. 무한이면 이것 하나로 게임 전체를 우회할 수 있다
    charges: 3,
    usage: '던지면 소리로 좀비를 그쪽에 끌어모은다 — 싸우지 않고 지나갈 때 쓴다',
    damage: 0, cooldown: 1.0, radius: 0, fuse: 0.6,
    lure: true, lureRadius: 30, lureDuration: 12,   // 좀비를 유인한다
    noise: 'interact', viewColor: 0x554e46, viewScale: [0.16, 0.1, 0.08],
  },
};

/** 시작 장비 */
export const STARTING_LOADOUT = ['pipe', 'pistol'];

/** 슬롯별 첫 무기 조회용 */
export function weaponsInSlot(slot) {
  return Object.values(WEAPONS).filter((w) => w.slot === slot);
}
