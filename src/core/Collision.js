/**
 * Collision — XZ 평면 AABB 충돌. 병원은 층별 평면 구조라 2D 충돌로 충분하다.
 * (NavMesh 없음 — 1주 스코프. PROGRESS.md 의 "알려진 함정" 참조)
 */
export class Collision {
  constructor() {
    this.boxes = [];   // { minX, minZ, maxX, maxZ }
  }

  clear() { this.boxes.length = 0; }

  /**
   * 중심(cx,cz) 기준 폭 w, 깊이 d 박스 추가.
   *
   * @param h 박스 **윗면 높이(m)**. 기본은 무한 — 벽처럼 끝까지 막는다.
   *   낮은 물건(넘어진 자판기 0.9m, 벤치 0.5m)에 이 값을 주면 **그 위로 지나가는
   *   총알은 통과한다.** 안 주던 시절에는 무릎 높이 잔해가 보이지 않는 벽이 되어
   *   그 너머의 좀비를 쏠 수 없었다. 이동은 여전히 막는다 — 넘어갈 수단이 없다.
   * @returns 박스 객체. `box.enabled = false` 로 끄면 통과할 수 있다 (문 열기용).
   */
  addBox(cx, cz, w, d, h = Infinity) {
    const box = {
      minX: cx - w / 2, maxX: cx + w / 2,
      minZ: cz - d / 2, maxZ: cz + d / 2,
      h,
      enabled: true,
    };
    this.boxes.push(box);
    return box;
  }

  /**
   * 반지름 r 의 원을 (x,z) 에서 벽 밖으로 밀어낸다. 슬라이딩 이동이 자연스럽게 된다.
   * @returns {{x:number, z:number, hit:boolean}}
   */
  resolve(x, z, r) {
    let hit = false;
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (!b.enabled) continue;                 // 열린 문
      // 원 중심에서 박스까지 가장 가까운 점
      const cx = Math.max(b.minX, Math.min(x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
      const dx = x - cx;
      const dz = z - cz;
      const d2 = dx * dx + dz * dz;

      if (d2 >= r * r) continue;
      hit = true;

      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const push = (r - d) / d;
        x += dx * push;
        z += dz * push;
      } else {
        // 중심이 박스 안 — 가장 얕은 면으로 밀어낸다
        const left = x - b.minX, right = b.maxX - x;
        const back = z - b.minZ, front = b.maxZ - z;
        const m = Math.min(left, right, back, front);
        if (m === left) x = b.minX - r;
        else if (m === right) x = b.maxX + r;
        else if (m === back) z = b.minZ - r;
        else z = b.maxZ + r;
      }
    }
    return { x, z, hit };
  }

  /** (x,z) 가 벽 안인가 — 스폰 지점 검증용 */
  /**
   * @param y 이 높이를 지나가는 것인가. 주면 **그보다 낮은 박스는 무시한다**
   *   (총알이 넘어진 자판기 위로 지나가는 경우). 안 주면 예전과 똑같이 전부 막는다 —
   *   플레이어 이동·좀비 경로는 높이를 안 넘기므로 동작이 바뀌지 않는다.
   */
  isBlocked(x, z, r = 0.3, y = null) {
    for (const b of this.boxes) {
      if (!b.enabled) continue;
      if (y !== null && b.h <= y) continue;
      if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) return true;
    }
    return false;
  }

  /**
   * XZ 선분이 벽에 막히는지 (시야 판정 / 좀비 회피 / 소리 차폐).
   * 일정 간격 샘플링 — **간격이 벽 두께보다 크면 벽을 건너뛴다.**
   * 벽 두께가 0.2m 이므로 기본값은 그보다 작아야 한다. (0.5 로 두면 벽 너머가 다 보인다)
   */
  /** @param y `isBlocked` 와 같다 — 이 높이보다 낮은 박스는 무시한다 */
  segmentBlocked(x0, z0, x1, z1, step = 0.14, y = null) {
    const dx = x1 - x0, dz = z1 - z0;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-4) return false;
    const n = Math.max(1, Math.ceil(dist / step));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      if (this.isBlocked(x0 + dx * t, z0 + dz * t, 0.05, y)) return true;
    }
    return false;
  }
}
