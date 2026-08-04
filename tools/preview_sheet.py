"""import_props.py 가 만든 미리보기를 한 장으로 모은다.

사용법:
    python tools/preview_sheet.py [출력.png]

30장을 따로 보면 비교가 안 된다. 붉은 막대(1.75m)가 전부 같은 높이로
찍혀 있으므로, 한 장에 늘어놓으면 크기가 틀어진 모델이 바로 눈에 띈다.
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

PREVIEW = Path(__file__).resolve().parent / "preview"
COLS = 6
CELL = 240
LABEL = 26


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else PREVIEW / "_sheet.png"
    results = json.loads((PREVIEW / "result.json").read_text(encoding="utf-8"))
    items = [r for r in results if "error" not in r]

    rows = (len(items) + COLS - 1) // COLS
    sheet = Image.new("RGB", (COLS * CELL, rows * (CELL + LABEL)), (24, 24, 27))
    draw = ImageDraw.Draw(sheet)

    for i, r in enumerate(items):
        png = PREVIEW / f"{r['name']}.png"
        if not png.exists():
            continue
        x = (i % COLS) * CELL
        y = (i // COLS) * (CELL + LABEL)
        sheet.paste(Image.open(png).convert("RGB").resize((CELL, CELL)), (x, y))
        w, h, d = r["size"]
        draw.text((x + 4, y + CELL + 2), r["name"].replace("prop_", ""), (235, 235, 235))
        draw.text((x + 4, y + CELL + 13),
                  f"{w:.2f} x {h:.2f}h x {d:.2f}  {r['tris']:,}t", (150, 150, 155))
        draw.rectangle([x, y, x + CELL - 1, y + CELL + LABEL - 1], outline=(60, 60, 66))

    sheet.save(out)
    print(f"{out}  ({sheet.size[0]}x{sheet.size[1]}, {len(items)}개)")


if __name__ == "__main__":
    main()
