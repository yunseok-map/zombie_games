"""ambientCG 원본 → 게임용 표면 텍스처 (벽 · 바닥 · 천장)

사용법:
    python tools/gen_surfaces.py            # 1024 로 재인코딩
    python tools/gen_surfaces.py 512        # 되돌리기

원본은 `tools/source_textures/*.zip` (ambientCG, CC0). public/ 밖이라 빌드에 안 실린다.
받는 곳: https://ambientcg.com/get?file=<ID>_1K-PNG.zip

하는 일
  1. zip 안에서 Color / NormalGL / Roughness / AmbientOcclusion 을 꺼낸다
  2. **AO 를 Color 에 곱해 굽는다.** 손전등 하나뿐이라 실시간 AO 를 못 쓴다
     (넣어 봤더니 프레임이 절반이 된다 — PROGRESS.md 참조). 그래서 틈새 그늘을
     텍스처에 미리 넣어 둔다. 이게 있고 없고가 벽의 깊이감을 가른다.
  3. 정사각으로 리사이즈 후 WebP 로 저장

주의
  - **NormalGL 을 쓴다.** NormalDX 는 초록 채널이 뒤집혀 있어 요철이 반대로 파인다.
  - 노멀·러프니스는 색이 아니라 **데이터**다. 감마를 건드리면 안 된다(그냥 리사이즈만).
    색상 맵만 sRGB 다.
"""
import sys
import zipfile
from io import BytesIO
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tools/source_textures"
OUT = ROOT / "public/assets/textures/surfaces"

# AO 를 색에 섞는 비율. 1.0 이면 그늘이 과해 지저분하고, 0 이면 평평해 보인다.
AO_MIX = 0.55
Q_COLOR = 88
Q_DATA = 92        # 노멀은 압축 티가 나면 표면이 물결친다. 색보다 높게 준다.

# 원본 ID → 게임 파일 이름
SETS = {
    "PaintedPlaster015": "wall_plaster_peeling",
    "Tiles040": "floor_tile_hospital",
    "OfficeCeiling001": "ceiling_panel_office",
}


def load(zf, names, key):
    """zip 안에서 접미사가 key 인 이미지를 꺼낸다. 없으면 None."""
    hit = next((n for n in names if n.endswith(f"_{key}.png")), None)
    return Image.open(BytesIO(zf.read(hit))) if hit else None


def build(asset_id, stem, size):
    zpath = SRC / f"{asset_id}_1K-PNG.zip"
    if not zpath.exists():
        print(f"  !! 원본 없음: {zpath.name}")
        return 0
    with zipfile.ZipFile(zpath) as zf:
        names = zf.namelist()
        color = load(zf, names, "Color").convert("RGB")
        normal = load(zf, names, "NormalGL")
        rough = load(zf, names, "Roughness")
        ao = load(zf, names, "AmbientOcclusion")

        if ao is not None:
            # AO 를 곱하되 AO_MIX 만큼만 — 원본 AO 를 100% 곱하면 새까매진다
            ao_g = ao.convert("L").resize(color.size, Image.LANCZOS)
            px_c = color.load()
            px_a = ao_g.load()
            w, h = color.size
            for y in range(h):
                for x in range(w):
                    a = px_a[x, y] / 255.0
                    k = 1.0 - AO_MIX + AO_MIX * a
                    r, g, b = px_c[x, y]
                    px_c[x, y] = (int(r * k), int(g * k), int(b * k))

        # 색상만 크게 간다. 눈이 보는 디테일(얼룩·벗겨진 자국)은 색에 있고,
        # 노멀·러프니스는 절반 해상도로 낮춰도 화면에서 구분이 안 된다.
        # 1024 로 전부 올리면 최악 구역이 16.2ms(62fps)까지 떨어졌다 — 텍셀이 4배라
        # 대역폭을 그만큼 더 먹는다. 색만 올리면 그 비용의 절반이다.
        total = 0
        outs = [
            (f"{stem}_color.webp", color, Q_COLOR, size),
            (f"{stem}_normal.webp", normal.convert("RGB") if normal else None, Q_DATA, size // 2),
            (f"{stem}_rough.webp", rough.convert("L") if rough else None, Q_DATA, size // 2),
        ]
        for name, img, q, px in outs:
            if img is None:
                print(f"  !! 맵 없음: {name}")
                continue
            img = img.resize((px, px), Image.LANCZOS)
            path = OUT / name
            img.save(path, "WEBP", quality=q, method=6)
            kb = path.stat().st_size / 1024
            total += path.stat().st_size
            print(f"  {name:42} {px}px  {kb:7.1f}KB")
        return total


def main():
    size = int(sys.argv[1]) if len(sys.argv) > 1 else 1024
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"표면 텍스처 재인코딩 — {size}px (AO {int(AO_MIX * 100)}% 합성)")
    total = sum(build(a, s, size) for a, s in SETS.items())
    print(f"합계 {total / 1e6:.2f}MB")
    px = 3 * size * size + 6 * (size // 2) ** 2
    print("GPU 메모리는 파일 크기가 아니라 픽셀 수로 든다: "
          f"색 3장 {size}² + 노멀·러프 6장 {size // 2}² × 4B "
          f"≈ {px * 4 / 1e6:.0f}MB (밉맵 포함 시 약 1.33배)")


if __name__ == "__main__":
    main()
