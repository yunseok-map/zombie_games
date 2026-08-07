"""GLB 안에 박힌 텍스처만 줄여서 제자리에 다시 쓴다. (Blender 불필요)

왜 별도 도구인가 —
    `import_props.py` 를 다시 돌리면 소품이 전부 새로 변환된다. 축·크기·원점을 다시
    계산하므로 24종이 한꺼번에 어긋날 수 있다(ASSETS.md 의 함정 목록 참고).
    용량만 줄이고 싶을 때 그 위험을 질 이유가 없다. 이 도구는 **이미지 바이트만**
    갈아끼우고 지오메트리·노드·애니메이션은 한 바이트도 건드리지 않는다.

사용법:
    python tools/glb_shrink_textures.py --max 512 --quality 80 public/assets/models/props/*.glb
    python tools/glb_shrink_textures.py --max 512 --dry-run <glb...>     # 재보기만

되돌리기: 결과물은 전부 커밋돼 있으므로 `git restore <경로>` 면 끝난다.
"""
import argparse
import glob
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


def read_glb(path):
    with open(path, "rb") as f:
        magic, version, _total = struct.unpack("<III", f.read(12))
        if magic != 0x46546C67:
            raise SystemExit(f"{path}: GLB 가 아니다")
        js = bin_ = None
        while True:
            head = f.read(8)
            if len(head) < 8:
                break
            length, ctype = struct.unpack("<II", head)
            data = f.read(length)
            if ctype == JSON_CHUNK:
                js = json.loads(data.decode("utf-8"))
            elif ctype == BIN_CHUNK:
                bin_ = data
    if js is None or bin_ is None:
        raise SystemExit(f"{path}: JSON/BIN 청크를 못 찾았다")
    return js, bin_


def write_glb(path, js, bin_):
    jb = json.dumps(js, separators=(",", ":")).encode("utf-8")
    jb += b" " * ((4 - len(jb) % 4) % 4)          # JSON 은 공백으로 채운다
    bb = bin_ + b"\x00" * ((4 - len(bin_) % 4) % 4)   # BIN 은 0 으로
    total = 12 + 8 + len(jb) + 8 + len(bb)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(jb), JSON_CHUNK))
        f.write(jb)
        f.write(struct.pack("<II", len(bb), BIN_CHUNK))
        f.write(bb)


def shrink(path, max_px, quality, dry):
    js, bin_ = read_glb(path)
    views = js.get("bufferViews", [])
    images = js.get("images", [])
    before = os.path.getsize(path)

    # 이미지가 쓰는 bufferView 를 찾는다. 다른 용도와 겹치면 손대지 않는다 —
    # 겹친 상태로 길이를 바꾸면 메시나 애니메이션이 통째로 깨진다.
    img_views = {}
    for i, img in enumerate(images):
        bv = img.get("bufferView")
        if bv is not None:
            img_views.setdefault(bv, []).append(i)

    other = set()
    for a in js.get("accessors", []):
        if a.get("bufferView") is not None:
            other.add(a["bufferView"])
    clash = set(img_views) & other
    if clash:
        print(f"  ! {os.path.basename(path)}: bufferView {sorted(clash)} 가 이미지와 데이터에 같이 쓰인다 — 건너뜀")
        return before, before

    # 이미지 다시 인코딩
    new_bytes = {}
    notes = []
    for bv, idxs in img_views.items():
        v = views[bv]
        off, ln = v.get("byteOffset", 0), v["byteLength"]
        raw = bin_[off:off + ln]
        try:
            im = Image.open(io.BytesIO(raw))
            im.load()
        except Exception as e:
            notes.append(f"    ! 이미지 해석 실패({e}) — 그대로 둔다")
            continue
        w, h = im.size
        if max(w, h) > max_px:
            s = max_px / max(w, h)
            im = im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
        im = im.convert("RGBA" if ("A" in im.getbands()) else "RGB")
        out = io.BytesIO()
        im.save(out, format="WEBP", quality=quality, method=6)
        enc = out.getvalue()
        if len(enc) >= ln and im.size == (w, h):
            continue                       # 더 커지면 굳이 바꾸지 않는다
        new_bytes[bv] = enc
        name = images[idxs[0]].get("name", f"image{idxs[0]}")
        notes.append(f"    {name:<28} {w}x{h} -> {im.size[0]}x{im.size[1]}   {ln/1024:6.0f} -> {len(enc)/1024:6.0f} KB")
        for i in idxs:
            images[i]["mimeType"] = "image/webp"

    if not new_bytes:
        print(f"  {os.path.basename(path):<32} 줄일 것 없음")
        return before, before
    if dry:
        saved = sum(views[b]['byteLength'] - len(new_bytes[b]) for b in new_bytes)
        print(f"  {os.path.basename(path):<32} {before/1024/1024:.2f} MB  → 약 {(before-saved)/1024/1024:.2f} MB (예상)")
        for n in notes:
            print(n)
        return before, before - saved

    # BIN 을 다시 쌓는다. bufferView 순서를 유지하고 4바이트 정렬을 지킨다.
    parts, cursor = [], 0
    for i, v in enumerate(views):
        data = new_bytes.get(i)
        if data is None:
            off = v.get("byteOffset", 0)
            data = bin_[off:off + v["byteLength"]]
        pad = (4 - cursor % 4) % 4
        if pad:
            parts.append(b"\x00" * pad)
            cursor += pad
        v["byteOffset"] = cursor
        v["byteLength"] = len(data)
        parts.append(data)
        cursor += len(data)

    new_bin = b"".join(parts)
    js["buffers"][0]["byteLength"] = len(new_bin)
    write_glb(path, js, new_bin)
    after = os.path.getsize(path)
    print(f"  {os.path.basename(path):<32} {before/1024/1024:6.2f} → {after/1024/1024:6.2f} MB")
    for n in notes:
        print(n)
    return before, after


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=512, help="긴 변 최대 픽셀 (기본 512)")
    ap.add_argument("--quality", type=int, default=80, help="WebP 품질 (기본 80)")
    ap.add_argument("--dry-run", action="store_true", help="쓰지 않고 결과만 본다")
    ap.add_argument("files", nargs="+")
    a = ap.parse_args()

    paths = []
    for pat in a.files:
        paths.extend(sorted(glob.glob(pat)) if any(c in pat for c in "*?[") else [pat])

    tb = ta = 0
    print(f"목표: 긴 변 {a.max}px · WebP 품질 {a.quality}" + ("  (예행)" if a.dry_run else ""))
    for p in paths:
        b, x = shrink(p, a.max, a.quality, a.dry_run)
        tb += b
        ta += x
    print(f"\n합계 {tb/1024/1024:.2f} MB → {ta/1024/1024:.2f} MB  ({(tb-ta)/1024/1024:.2f} MB 절감)")


if __name__ == "__main__":
    main()
