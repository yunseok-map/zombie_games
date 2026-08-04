"""명패 · 포스터 · 표지 아틀라스 생성기
출력: public/assets/textures/signage_atlas.webp (1024, 4x4 = 16칸)

각 칸은 실제 사용될 판의 비율로 그린 뒤 256x256 으로 눌러 담는다.
벽에 붙을 때 다시 늘어나면서 원래 비율로 보인다 — 안 그러면 글자가 찌그러진다.

실존 기관·브랜드명 금지 (CLAUDE.md §2). 병원명은 항상 제3격리병원.
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = r"C:\Users\A\Desktop\games_zombie\public\assets\textures\signage_atlas.webp"
FONT = r"C:\Windows\Fonts\malgun.ttf"
FONTB = r"C:\Windows\Fonts\malgunbd.ttf"
CELL, COLS, ROWS = 256, 4, 4


def f(size, bold=False):
    try:
        return ImageFont.truetype(FONTB if bold else FONT, size)
    except OSError:
        return ImageFont.truetype(FONT, size)


def center(dr, xy, text, font, fill, anchor="mm"):
    dr.text(xy, text, font=font, fill=fill, anchor=anchor)


def grime(img, seed, amount=0.35):
    """때·얼룩. 깨끗한 판은 폐병원에 안 어울린다"""
    import random
    rnd = random.Random(seed)
    dr = ImageDraw.Draw(img, 'RGBA')
    w, h = img.size
    for _ in range(int(120 * amount)):
        x, y = rnd.randrange(w), rnd.randrange(h)
        r = rnd.randint(2, 26)
        a = rnd.randint(6, 34)
        dr.ellipse([x - r, y - r, x + r, y + r], fill=(30, 26, 18, a))
    for _ in range(int(8 * amount)):                      # 흘러내린 자국
        x = rnd.randrange(w)
        dr.line([(x, 0), (x + rnd.randint(-6, 6), h)], fill=(40, 34, 22, 22), width=rnd.randint(2, 7))
    return img


# ── 칸 그리기 ─────────────────────────────────────────────
def nameplate(text, sub=None, seed=0):
    W, H = 520, 200
    im = Image.new('RGB', (W, H), (34, 40, 36))
    dr = ImageDraw.Draw(im)
    dr.rectangle([6, 6, W - 7, H - 7], outline=(96, 108, 98), width=3)
    if sub:
        center(dr, (W / 2, H / 2 - 26), text, f(78, True), (214, 222, 210))
        center(dr, (W / 2, H / 2 + 52), sub, f(34), (150, 162, 148))
    else:
        center(dr, (W / 2, H / 2), text, f(84, True), (214, 222, 210))
    return grime(im, seed, 0.5)


def poster(title, lines, seed, accent=(150, 40, 32)):
    W, H = 400, 560
    im = Image.new('RGB', (W, H), (206, 200, 178))
    dr = ImageDraw.Draw(im)
    dr.rectangle([0, 0, W - 1, 92], fill=accent)
    center(dr, (W / 2, 46), title, f(40, True), (240, 236, 226))
    y = 130
    for ln in lines:
        center(dr, (W / 2, y), ln, f(27), (52, 46, 40))
        y += 46
    dr.rectangle([28, H - 96, W - 29, H - 40], outline=(120, 110, 96), width=2)
    center(dr, (W / 2, H - 68), "제3격리병원", f(26, True), (96, 88, 76))
    return grime(im, seed, 1.0)


def exit_sign():
    W, H = 480, 200
    im = Image.new('RGB', (W, H), (18, 96, 56))
    dr = ImageDraw.Draw(im)
    dr.rectangle([5, 5, W - 6, H - 6], outline=(150, 240, 190), width=4)
    center(dr, (W / 2 - 70, H / 2), "비상구", f(76, True), (232, 255, 240))
    dr.polygon([(W / 2 + 70, H / 2 - 44), (W / 2 + 150, H / 2), (W / 2 + 70, H / 2 + 44)],
               fill=(232, 255, 240))
    return im


def direction_sign():
    W, H = 640, 180
    im = Image.new('RGB', (W, H), (38, 46, 42))
    dr = ImageDraw.Draw(im)
    dr.rectangle([5, 5, W - 6, H - 6], outline=(100, 112, 102), width=3)
    center(dr, (W / 2, 56), "←  응급실 · 접수", f(40), (206, 214, 202))
    dr.line([(30, 92), (W - 31, 92)], fill=(90, 100, 92), width=2)
    center(dr, (W / 2, 128), "계단실 · 옥상  →", f(40), (206, 214, 202))
    return grime(im, 7, 0.4)


def floor_map():
    W, H = 460, 560
    im = Image.new('RGB', (W, H), (198, 194, 176))
    dr = ImageDraw.Draw(im)
    center(dr, (W / 2, 46), "1F 안내도", f(42, True), (46, 42, 36))
    dr.rectangle([40, 96, W - 41, H - 60], outline=(70, 64, 56), width=3)
    dr.rectangle([W / 2 - 34, 150, W / 2 + 34, H - 120], fill=(228, 224, 208), outline=(70, 64, 56), width=2)
    for i in range(5):                                     # 병실 칸
        y = 160 + i * 62
        dr.rectangle([54, y, W / 2 - 40, y + 50], outline=(70, 64, 56), width=2)
        dr.rectangle([W / 2 + 40, y, W - 55, y + 50], outline=(70, 64, 56), width=2)
    center(dr, (W / 2, H - 88), "현 위치", f(28, True), (168, 44, 36))
    return grime(im, 11, 0.8)


def notice_torn():
    W, H = 400, 520
    im = Image.new('RGB', (W, H), (204, 196, 172))
    dr = ImageDraw.Draw(im)
    center(dr, (W / 2, 70), "출입 통제", f(56, True), (150, 38, 30))
    dr.line([(50, 116), (W - 51, 116)], fill=(150, 38, 30), width=4)
    for i, ln in enumerate(["관계자 외 출입을 금합니다", "방호복 착용 필수",
                            "감염 의심 시 즉시 보고", "", "— 시설 관리과"]):
        center(dr, (W / 2, 170 + i * 52), ln, f(28), (54, 48, 40))
    dr.polygon([(0, H), (W, H), (W, H - 90), (W * 0.6, H - 30),
                (W * 0.3, H - 70), (0, H - 20)], fill=(24, 24, 22))   # 찢어진 아랫단
    return grime(im, 13, 1.2)


CELLS = [
    nameplate("301", "일반병실"), nameplate("302", "일반병실"),
    nameplate("303", "일반병실"), nameplate("처치실"),
    nameplate("격리 A", "ISOLATION"), nameplate("간호사실"),
    nameplate("물품보관"), nameplate("소독실"),
    poster("검역 경고", ["이 구역은 격리 대상입니다", "허가 없는 출입을 금합니다",
                        "감염 위험 — 방호 장비 착용", "", "위반 시 즉시 격리 조치"], 3),
    poster("감염 예방 수칙", ["1. 손을 자주 씻으십시오", "2. 마스크를 항상 착용",
                            "3. 발열 시 즉시 신고", "4. 접촉을 최소화", "5. 지정 통로만 이용"], 5,
           (46, 78, 62)),
    floor_map(), direction_sign(),
    exit_sign(), notice_torn(),
    nameplate("영안실", "MORTUARY"), nameplate("기계실", "B1"),
]

sheet = Image.new('RGB', (CELL * COLS, CELL * ROWS), (12, 12, 12))
for i, cell in enumerate(CELLS[:COLS * ROWS]):
    sheet.paste(cell.resize((CELL, CELL), Image.LANCZOS),
                ((i % COLS) * CELL, (i // COLS) * CELL))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
sheet.save(OUT, quality=90, method=5)
print(f"저장: {OUT}  {os.path.getsize(OUT)//1024} KB  {COLS}x{ROWS}칸")
for i, _ in enumerate(CELLS[:COLS * ROWS]):
    print(f"  [{i//COLS},{i%COLS}] slot {i}")
