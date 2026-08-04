"""GLB 안에 무엇이 들어있는지 목록과 실측치를 뽑는다 (Blender 없이).

사용법:
    python tools/glb_inspect.py public/assets/models/props/morgue_room.glb

GLB 는 [헤더][JSON 청크][BIN 청크] 구조라서 JSON 만 읽으면
노드 이름 · 메시별 삼각형 수 · 텍스처 장수를 알 수 있다.
POSITION 접근자에는 min/max 가 들어있으므로 **크기(m)도 BIN 을 안 읽고 잴 수 있다.**

Sketchfab 모델은 축·원점·스케일이 제각각이라 추측하면 반드시 틀린다.
`import_props.py` 의 목표 치수를 정하기 전에 이걸로 원본을 먼저 잰다.
Blender 를 띄우면 파일당 수십 초 걸리므로 조사 단계에서는 이걸 쓴다.
"""
import json
import math
import struct
import sys
from pathlib import Path


def read_gltf_json(path):
    with open(path, "rb") as f:
        magic, _version, _length = struct.unpack("<III", f.read(12))
        if magic != 0x46546C67:
            raise ValueError(f"{path}: GLB 가 아니다")
        chunk_len, chunk_type = struct.unpack("<II", f.read(8))
        if chunk_type != 0x4E4F534A:
            raise ValueError(f"{path}: 첫 청크가 JSON 이 아니다")
        return json.loads(f.read(chunk_len).decode("utf-8"))


def mesh_tris(gltf, mesh):
    """메시 하나의 삼각형 수. 인덱스가 있으면 인덱스 수/3, 없으면 정점 수/3."""
    total = 0
    for prim in mesh.get("primitives", []):
        if prim.get("mode", 4) != 4:  # 4 = TRIANGLES
            continue
        if "indices" in prim:
            total += gltf["accessors"][prim["indices"]]["count"] // 3
        else:
            pos = prim.get("attributes", {}).get("POSITION")
            if pos is not None:
                total += gltf["accessors"][pos]["count"] // 3
    return total


# ── 노드 변환 계산 ────────────────────────────────────────────────────────
# glTF 노드는 matrix(열우선 16개) 또는 T/R/S 로 변환을 갖는다.
# 부모→자식으로 누적해야 오브젝트의 실제 월드 크기가 나온다.
# (스케일이 노드에 들어있는 모델이 흔해서, 메시 로컬 min/max 만 보면 틀린다.)

def mat_identity():
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]


def mat_mul(a, b):
    """열우선 4x4 곱 (a 다음 b 가 아니라, a * b — a 가 부모)."""
    out = [0.0] * 16
    for c in range(4):
        for r in range(4):
            out[c * 4 + r] = sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4))
    return out


def mat_from_trs(node):
    t = node.get("translation", [0, 0, 0])
    r = node.get("rotation", [0, 0, 0, 1])   # 쿼터니언 x,y,z,w
    s = node.get("scale", [1, 1, 1])
    x, y, z, w = r
    # 쿼터니언 → 3x3 회전
    rot = [
        1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
        2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
        2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y),
    ]
    m = mat_identity()
    for c in range(3):
        for rr in range(3):
            m[c * 4 + rr] = rot[c * 3 + rr] * s[c]
    m[12], m[13], m[14] = t
    return m


def node_matrix(node):
    if "matrix" in node:
        return list(node["matrix"])
    return mat_from_trs(node)


def xform(m, p):
    x, y, z = p
    return (
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14],
    )


def mesh_bounds(gltf, mesh):
    """메시의 로컬 min/max. POSITION 접근자의 min/max 를 합친다."""
    lo = [math.inf] * 3
    hi = [-math.inf] * 3
    for prim in mesh.get("primitives", []):
        pos = prim.get("attributes", {}).get("POSITION")
        if pos is None:
            continue
        acc = gltf["accessors"][pos]
        if "min" not in acc or "max" not in acc:
            continue
        for i in range(3):
            lo[i] = min(lo[i], acc["min"][i])
            hi[i] = max(hi[i], acc["max"][i])
    return (lo, hi) if lo[0] != math.inf else None


def world_bounds(gltf, only_node=None):
    """씬 전체(또는 노드 하나)의 월드 바운딩박스. glTF 는 Y-up 이므로
    반환값 y 가 곧 게임 안에서의 높이다."""
    meshes = gltf.get("meshes", [])
    nodes = gltf.get("nodes", [])
    lo = [math.inf] * 3
    hi = [-math.inf] * 3

    def walk(idx, parent, inside):
        node = nodes[idx]
        m = mat_mul(parent, node_matrix(node))
        hit = inside or (only_node is not None and node.get("name") == only_node)
        mi = node.get("mesh")
        if mi is not None and (only_node is None or hit):
            b = mesh_bounds(gltf, meshes[mi])
            if b:
                blo, bhi = b
                # 회전이 섞이면 8개 꼭짓점을 전부 변환해야 정확하다
                for cx in (blo[0], bhi[0]):
                    for cy in (blo[1], bhi[1]):
                        for cz in (blo[2], bhi[2]):
                            wx, wy, wz = xform(m, (cx, cy, cz))
                            for i, v in enumerate((wx, wy, wz)):
                                lo[i] = min(lo[i], v)
                                hi[i] = max(hi[i], v)
        for ch in node.get("children", []):
            walk(ch, m, hit)

    scene = gltf.get("scenes", [{}])[gltf.get("scene", 0)]
    for root in scene.get("nodes", range(len(nodes))):
        walk(root, mat_identity(), False)

    if lo[0] == math.inf:
        return None
    return [hi[i] - lo[i] for i in range(3)], lo, hi


def report(path):
    gltf = read_gltf_json(path)
    meshes = gltf.get("meshes", [])
    nodes = gltf.get("nodes", [])

    print(f"\n{'=' * 78}\n{Path(path).name}  ({Path(path).stat().st_size / 1e6:.1f} MB)\n{'=' * 78}")

    # 노드 → 메시 연결. 노드 이름이 Blender 에서 보이는 오브젝트 이름이다.
    rows = []
    for node in nodes:
        mi = node.get("mesh")
        if mi is None:
            continue
        rows.append((node.get("name", "(이름없음)"), mesh_tris(gltf, meshes[mi]), mi))
    rows.sort(key=lambda r: -r[1])

    wb = world_bounds(gltf)
    if wb:
        d, lo, _ = wb
        print(f"전체 크기(m):  X {d[0]:.2f} × Y(높이) {d[1]:.2f} × Z {d[2]:.2f}"
              f"   바닥 y={lo[1]:.2f}")

    print(f"\n{'오브젝트(노드) 이름':<44} {'삼각형':>9}  {'크기 X×Y×Z (m)':>22}")
    print("-" * 78)
    for name, tris, _ in rows:
        nb = world_bounds(gltf, only_node=name) if tris >= 100 else None
        size = f"{nb[0][0]:6.2f}×{nb[0][1]:5.2f}×{nb[0][2]:5.2f}" if nb else ""
        print(f"{name:<44} {tris:>9,}  {size:>22}")
    print("-" * 78)
    print(f"{'합계':<44} {sum(r[1] for r in rows):>9,}  (노드 {len(rows)}개)")

    # 메시에 붙지 않은 노드(빈 오브젝트·라이트·카메라)도 이름만 보여준다.
    empties = [n.get("name", "?") for n in nodes if "mesh" not in n]
    if empties:
        print(f"메시 없는 노드 {len(empties)}개: {', '.join(empties[:12])}"
              + (" ..." if len(empties) > 12 else ""))

    imgs = gltf.get("images", [])
    if imgs:
        print(f"이미지 {len(imgs)}장: "
              + ", ".join(i.get("name", i.get("mimeType", "?")) for i in imgs[:10])
              + (" ..." if len(imgs) > 10 else ""))


def size_line(path):
    """--sizes: 파일당 한 줄. 19개를 한눈에 훑을 때."""
    gltf = read_gltf_json(path)
    wb = world_bounds(gltf)
    tris = sum(mesh_tris(gltf, m) for m in gltf.get("meshes", []))
    mb = Path(path).stat().st_size / 1e6
    if not wb:
        print(f"{Path(path).stem:<46} {mb:5.1f}MB  (지오메트리 없음)")
        return
    d, lo, _ = wb
    # 세로로 긴 물건인지(서 있는지) 표시 — 누워서 들어온 모델을 잡아내려는 것
    tallest = "XYZ"[max(range(3), key=lambda i: d[i])]
    print(f"{Path(path).stem:<46} {mb:5.1f}MB {tris:>8,}tri  "
          f"{d[0]:6.2f}×{d[1]:6.2f}×{d[2]:6.2f}m  최장축={tallest}  바닥y={lo[1]:6.2f}")


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)
    if args[0] == "--sizes":
        print(f"{'파일':<46} {'용량':>7} {'삼각형':>11}  {'크기 X×Y×Z':^24}")
        print("-" * 110)
        for t in args[1:]:
            size_line(t)
    else:
        for t in args:
            report(t)
