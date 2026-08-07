"""GLB 에서 애니메이션을 통째로 들어내고 남은 데이터만 다시 담는다.

왜 필요한가 —
    좀비 본체를 늘릴 때마다 **같은 24클립이 통째로 한 벌씩 더 실린다**(본체당 약 2.2MB).
    Mixamo 리그는 뼈 이름이 같으므로 three.js 는 한 본체의 클립으로 다른 본체를
    돌릴 수 있다(PropertyBinding 이 **노드 이름**으로 붙는다). 그러면 클립은 한 벌이면 된다.

    **쓰기 전에 뼈 이름이 정말 같은지 확인해라.** 하나라도 어긋나면 three.js 가
    "no target node found" 를 console.warn 으로 뱉고, 이 프로젝트의 QA 는 그걸 실패로 센다.
    확인은 tools/glb_inspect.py 나 skins[].joints 이름 집합 비교로 한다.

사용법:
    python tools/glb_strip_animations.py public/assets/models/zombie_ch16.glb

되돌리기: `git restore <경로>` 또는 fbx_to_glb.py 로 다시 굽는다.
"""
import json
import os
import struct
import sys

JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942


def read_glb(path):
    with open(path, "rb") as f:
        magic, _ver, _total = struct.unpack("<III", f.read(12))
        if magic != 0x46546C67:
            raise SystemExit(f"{path}: GLB 가 아니다")
        js = bin_ = None
        while True:
            head = f.read(8)
            if len(head) < 8:
                break
            ln, ct = struct.unpack("<II", head)
            data = f.read(ln)
            if ct == JSON_CHUNK:
                js = json.loads(data.decode("utf-8"))
            elif ct == BIN_CHUNK:
                bin_ = data
    return js, bin_


def write_glb(path, js, bin_):
    jb = json.dumps(js, separators=(",", ":")).encode("utf-8")
    jb += b" " * ((4 - len(jb) % 4) % 4)
    bb = bin_ + b"\x00" * ((4 - len(bin_) % 4) % 4)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(jb) + 8 + len(bb)))
        f.write(struct.pack("<II", len(jb), JSON_CHUNK))
        f.write(jb)
        f.write(struct.pack("<II", len(bb), BIN_CHUNK))
        f.write(bb)


def strip(path):
    js, bin_ = read_glb(path)
    before = os.path.getsize(path)
    n_anim = len(js.get("animations", []))
    if not n_anim:
        print(f"  {os.path.basename(path)}: 애니메이션이 없다 — 그대로 둔다")
        return
    js.pop("animations", None)

    accessors = js.get("accessors", [])
    views = js.get("bufferViews", [])

    # ── 아직 쓰이는 accessor 를 모은다 ──────────────────────────────
    keep_acc = set()
    for mesh in js.get("meshes", []):
        for p in mesh.get("primitives", []):
            keep_acc.update(p.get("attributes", {}).values())
            if p.get("indices") is not None:
                keep_acc.add(p["indices"])
            for t in p.get("targets", []) or []:
                keep_acc.update(t.values())
    for sk in js.get("skins", []):
        if sk.get("inverseBindMatrices") is not None:
            keep_acc.add(sk["inverseBindMatrices"])

    acc_order = sorted(keep_acc)
    acc_map = {old: i for i, old in enumerate(acc_order)}

    # ── 그 accessor 와 이미지가 쓰는 bufferView 를 모은다 ───────────
    keep_bv = set()
    for old in acc_order:
        bv = accessors[old].get("bufferView")
        if bv is not None:
            keep_bv.add(bv)
    for img in js.get("images", []):
        if img.get("bufferView") is not None:
            keep_bv.add(img["bufferView"])

    bv_order = sorted(keep_bv)
    bv_map = {old: i for i, old in enumerate(bv_order)}

    # ── BIN 을 다시 쌓는다 (4바이트 정렬 유지) ──────────────────────
    parts, cursor, new_views = [], 0, []
    for old in bv_order:
        v = dict(views[old])
        off = v.get("byteOffset", 0)
        data = bin_[off:off + v["byteLength"]]
        pad = (4 - cursor % 4) % 4
        if pad:
            parts.append(b"\x00" * pad)
            cursor += pad
        v["byteOffset"] = cursor
        new_views.append(v)
        parts.append(data)
        cursor += len(data)
    new_bin = b"".join(parts)

    # ── 참조 갈아끼우기 ────────────────────────────────────────────
    new_acc = []
    for old in acc_order:
        a = dict(accessors[old])
        if a.get("bufferView") is not None:
            a["bufferView"] = bv_map[a["bufferView"]]
        new_acc.append(a)
    for mesh in js.get("meshes", []):
        for p in mesh.get("primitives", []):
            p["attributes"] = {k: acc_map[v] for k, v in p.get("attributes", {}).items()}
            if p.get("indices") is not None:
                p["indices"] = acc_map[p["indices"]]
            if p.get("targets"):
                p["targets"] = [{k: acc_map[v] for k, v in t.items()} for t in p["targets"]]
    for sk in js.get("skins", []):
        if sk.get("inverseBindMatrices") is not None:
            sk["inverseBindMatrices"] = acc_map[sk["inverseBindMatrices"]]
    for img in js.get("images", []):
        if img.get("bufferView") is not None:
            img["bufferView"] = bv_map[img["bufferView"]]

    js["accessors"] = new_acc
    js["bufferViews"] = new_views
    js["buffers"][0]["byteLength"] = len(new_bin)

    write_glb(path, js, new_bin)
    after = os.path.getsize(path)
    print(f"  {os.path.basename(path):<26} 클립 {n_anim}개 제거   "
          f"{before/1024/1024:.2f} → {after/1024/1024:.2f} MB  ({(before-after)/1024/1024:.2f} MB 절감)")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    for p in sys.argv[1:]:
        strip(p)
