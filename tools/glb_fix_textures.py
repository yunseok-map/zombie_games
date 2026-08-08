"""새까맣게 구워진 GLB 텍스처를 원본 모델에서 옮겨 심는다. (Blender 불필요)

왜 필요한가 —
    Blender glTF I/O 가 소품 4종(`prop_bed` · `prop_bodybag` · `prop_ivdrip` ·
    `prop_standing_body`)의 이미지를 **전 픽셀 0** 으로 내보냈다. 1024x1024 인데
    1.9KB — 단색 이미지 크기다. 게임에서는 손전등을 정면으로 비춰도 새까만
    실루엣만 보인다. 조명이나 노멀 문제로 오해하기 딱 좋다 (실제로 세 번 헛짚었다).

    `import_props.py` 를 다시 돌리면 24종의 축·크기·원점이 전부 다시 계산돼
    한꺼번에 어긋날 수 있다 (ASSETS.md 함정 목록). 마감 이틀 전에 질 위험이 아니다.
    이 도구는 **이미지 바이트만** 갈아끼운다 — 지오메트리·UV·노드·스케일은 그대로다.

사용법:
    python tools/glb_fix_textures.py --dry-run          # 무엇을 바꿀지만 본다
    python tools/glb_fix_textures.py                    # 실제로 고친다

되돌리기: `git restore public/assets/models/props/`
"""
import argparse
import io
import json
import os
import struct
import sys

try:
    from PIL import Image
except ImportError:
    raise SystemExit("Pillow 가 필요하다:  pip install Pillow")

JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942

# 고칠 소품 → 원본 모델. tools/source_models/ 안의 파일 이름.
PAIRS = [
    ("props/prop_bed", "hospital_bed"),
    ("props/prop_bodybag", "body_bag01"),
    ("props/prop_ivdrip", "crutch_and_iv_drip"),
    ("props/prop_standing_body", "sexy_zombie_girl"),
]

ROLES = ("색", "금속거칠기", "노멀", "발광", "AO")


def read_glb(path):
    with open(path, "rb") as f:
        magic, _v, _t = struct.unpack("<III", f.read(12))
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
    if js is None or bin_ is None:
        raise SystemExit(f"{path}: JSON/BIN 청크를 못 찾았다")
    return js, bin_


def write_glb(path, js, bin_):
    jb = json.dumps(js, separators=(",", ":")).encode("utf-8")
    jb += b" " * ((4 - len(jb) % 4) % 4)
    bb = bin_ + b"\x00" * ((4 - len(bin_) % 4) % 4)
    total = 12 + 8 + len(jb) + 8 + len(bb)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(jb), JSON_CHUNK))
        f.write(jb)
        f.write(struct.pack("<II", len(bb), BIN_CHUNK))
        f.write(bb)


def image_of(js, tex_index):
    """텍스처 → 이미지 인덱스. WebP 는 EXT_texture_webp 안에 source 가 들어간다."""
    t = js["textures"][tex_index]
    if "source" in t:
        return t["source"]
    return t.get("extensions", {}).get("EXT_texture_webp", {}).get("source")


def slots(js):
    """[(재질순번, 역할, 이미지인덱스)] — 재질 순서와 역할로 원본과 짝을 맞춘다."""
    out = []
    for mi, m in enumerate(js.get("materials", [])):
        pbr = m.get("pbrMetallicRoughness", {})
        pairs = (
            (pbr.get("baseColorTexture"), "색"),
            (pbr.get("metallicRoughnessTexture"), "금속거칠기"),
            (m.get("normalTexture"), "노멀"),
            (m.get("emissiveTexture"), "발광"),
            (m.get("occlusionTexture"), "AO"),
        )
        for ref, role in pairs:
            if ref is not None:
                out.append((mi, role, image_of(js, ref["index"])))
    return out


def decode(js, blob, idx):
    bv = js["bufferViews"][js["images"][idx]["bufferView"]]
    off, ln = bv.get("byteOffset", 0), bv["byteLength"]
    return Image.open(io.BytesIO(blob[off:off + ln]))


def fix(tgt_path, src_path, max_px, quality, dry):
    tj, tb = read_glb(tgt_path)
    sj, sb = read_glb(src_path)
    ts, ss = slots(tj), slots(sj)
    name = os.path.basename(tgt_path)

    smap = {(mi, role): idx for mi, role, idx in ss}
    plan = {}                                    # 대상 이미지 인덱스 → 새 바이트
    notes = []
    for mi, role, ti in ts:
        img = decode(tj, tb, ti)
        if max(img.convert("RGB").getextrema(), key=lambda e: e[1])[1] != 0:
            continue                             # 살아있는 텍스처는 손대지 않는다
        si = smap.get((mi, role))
        if si is None:
            notes.append(f"    ! 재질{mi} {role}: 원본에 짝이 없다 — 그대로 둔다")
            continue
        im = decode(sj, sb, si)
        im.load()
        w, h = im.size
        if max(w, h) > max_px:
            s = max_px / max(w, h)
            im = im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
        im = im.convert("RGBA" if "A" in im.getbands() else "RGB")
        out = io.BytesIO()
        im.save(out, format="WEBP", quality=quality, method=6)
        plan[ti] = out.getvalue()
        tj["images"][ti]["mimeType"] = "image/webp"
        notes.append(f"    재질{mi} {role:<6} 원본 image{si} {w}x{h} "
                     f"→ {im.size[0]}x{im.size[1]}  {len(plan[ti])/1024:.1f}KB")

    if not plan:
        print(f"  {name:<30} 고칠 것 없음")
        return False
    print(f"  {name:<30} 텍스처 {len(plan)}장 이식" + ("  (예행)" if dry else ""))
    for n in notes:
        print(n)
    if dry:
        return True

    # 이미지가 쓰는 bufferView 가 메시·애니메이션과 겹치면 손대지 않는다.
    view_of = {tj["images"][i]["bufferView"]: i for i in plan}
    used = {a["bufferView"] for a in tj.get("accessors", []) if a.get("bufferView") is not None}
    if set(view_of) & used:
        print("    ! bufferView 가 데이터와 겹친다 — 건너뜀")
        return False

    # BIN 을 순서대로 다시 쌓는다. 4바이트 정렬을 지킨다.
    parts, cursor = [], 0
    for i, v in enumerate(tj["bufferViews"]):
        data = plan.get(view_of.get(i, -1))
        if data is None:
            off = v.get("byteOffset", 0)
            data = tb[off:off + v["byteLength"]]
        pad = (4 - cursor % 4) % 4
        if pad:
            parts.append(b"\x00" * pad)
            cursor += pad
        v["byteOffset"] = cursor
        v["byteLength"] = len(data)
        parts.append(data)
        cursor += len(data)

    new_bin = b"".join(parts)
    tj["buffers"][0]["byteLength"] = len(new_bin)
    before = os.path.getsize(tgt_path)
    write_glb(tgt_path, tj, new_bin)
    print(f"    {before/1024/1024:.2f} → {os.path.getsize(tgt_path)/1024/1024:.2f} MB")
    return True


def main():
    ap = argparse.ArgumentParser()
    # 512 / 80 은 `glb_shrink_textures.py` 가 나머지 소품에 쓴 값이다. 이것만 1024 로
    # 넣으면 이 소품 하나가 텍스처 메모리 예산(CLAUDE.md §3)을 혼자 4배로 먹는다.
    ap.add_argument("--max", type=int, default=512, help="긴 변 최대 픽셀 (기본 512)")
    ap.add_argument("--quality", type=int, default=80, help="WebP 품질 (기본 80)")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    root = os.path.join(os.path.dirname(__file__), "..")
    n = 0
    print(f"죽은 텍스처를 원본에서 이식 — 긴 변 {a.max}px · 품질 {a.quality}\n")
    for tgt, src in PAIRS:
        tp = os.path.join(root, "public", "assets", "models", f"{tgt}.glb")
        sp = os.path.join(root, "tools", "source_models", f"{src}.glb")
        if not os.path.exists(tp) or not os.path.exists(sp):
            print(f"  {os.path.basename(tp):<30} 파일 없음 — 건너뜀")
            continue
        n += fix(tp, sp, a.max, a.quality, a.dry_run)
    print(f"\n{n}개 파일 처리")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
