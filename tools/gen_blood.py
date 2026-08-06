"""핏자국 데칼 생성기 — QUARANTINE No.3
출력: public/assets/textures/decal_blood_{pool,splatter,drag}.webp (512px, RGBA)
BRIGHT 값만 조정하면 전체 밝기가 바뀐다. 게임이 매우 어두워서 실제 마른 피보다 밝게 굽는다.
"""
import numpy as np, os, sys
from PIL import Image

# 경로는 이 파일 위치에서 구한다 — 절대경로를 박으면 다른 PC 에서 통째로 깨진다
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "assets", "textures", "decals")
S = 512
BRIGHT = float(sys.argv[1]) if len(sys.argv) > 1 else 2.4

# 마른 피는 빨강이 아니라 갈색이다. G/B 를 너무 낮추면 페인트처럼 보인다.
DRY  = np.array([0.105, 0.048, 0.040]) * BRIGHT
WETC = np.array([0.165, 0.050, 0.040]) * BRIGHT


def fbm(rng, octaves=7, base=3, gain=0.58):
    acc = np.zeros((S, S), np.float32); amp = 1.0; tot = 0.0
    for o in range(octaves):
        n = min(base * 2 ** o, S)
        g = rng.random((n, n)).astype(np.float32)
        im = Image.fromarray((g * 255).astype(np.uint8)).resize((S, S), Image.BICUBIC)
        acc += np.asarray(im, np.float32) / 255.0 * amp
        tot += amp; amp *= gain
    return acc / tot


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)


def colorize(a, fine):
    a = np.clip(a, 0, 1)
    core = smooth(0.55, 1.0, a)
    rgb = np.stack([DRY[c] * (1 - core) + WETC[c] * core for c in range(3)], -1).astype(np.float32)
    rgb *= (0.62 + 0.50 * fine)[..., None]                 # 얼룩 · 마른 결
    rgb *= (0.80 + 0.30 * smooth(0.0, 0.5, a))[..., None]  # 가장자리는 더 어둡게
    # ★ sRGB 인코딩. 여기 값은 선형이고 three.js 는 파일을 sRGB 로 읽는다.
    #   이걸 빼면 0.30 이 0.073 으로 디코딩돼서 화면에서 안 보인다.
    rgb = np.clip(rgb, 0, 1) ** (1 / 2.2)
    return Image.fromarray(np.dstack([rgb * 255, a * 255]).astype(np.uint8), 'RGBA')


def blob(seed, kind):
    rng = np.random.default_rng(seed)
    n = fbm(rng)
    fine = fbm(np.random.default_rng(seed + 99), octaves=8, base=8, gain=0.62)
    cx, cy, rad, sx = (S*0.5, S*0.34, S*0.28, 1.0) if kind == 'splatter' else (S*0.48, S*0.5, S*0.33, 1.15)
    r = np.hypot((xx - cx) * sx, (yy - cy)) / rad
    m = (1.15 - r) + (n - 0.5) * 1.05 + (fine - 0.5) * 0.22
    a = smooth(0.500, 0.534, m)                            # 좁은 밴드 = 날카로운 경계

    base_ang = rng.random() * 6.2832
    for _ in range(rng.integers(150, 240)):                # 튄 방울 — 한쪽으로 치우친 부채꼴
        ang = base_ang + (rng.random() - 0.5) * 2.6
        dist = rad * (0.85 + rng.random() ** 0.6 * 2.0)
        px, py = cx + np.cos(ang) * dist / sx, cy + np.sin(ang) * dist
        rr = 1.0 + rng.random() ** 3.2 * 7.0               # 대부분 아주 작고 가끔 크다
        ex = 1.0 + rng.random() * 1.8
        d = np.hypot((xx - px) / ex, (yy - py))
        a = np.maximum(a, smooth(rr + 0.9, rr * 0.5, d) * (0.55 + rng.random() * 0.45))

    if kind == 'splatter':                                 # 흘러내림 — 폭이 변하고 끝에 방울이 맺힌다
        for _ in range(rng.integers(9, 15)):
            px = cx + (rng.random() - 0.5) * rad * 1.9
            w0 = rng.random() * 2.6 + 1.3
            L = rng.random() * S * 0.40 + S * 0.12
            y0 = cy + rad * 0.55
            t = np.clip((yy - y0) / L, 0, 1)
            wob = np.sin(yy * 0.055 + rng.random() * 6.0) * 2.2
            w = w0 * (1.0 - 0.55 * t)
            body = np.exp(-((xx - px - wob) / np.maximum(w, 0.6)) ** 2) * smooth(y0 + L, y0, yy) * smooth(y0 - 8, y0 + 4, yy)
            dbulb = np.hypot(xx - px - np.sin((y0 + L) * 0.055 + 1) * 2.2, yy - (y0 + L))
            a = np.maximum(a, np.maximum(body * 0.92, smooth(w0 * 1.7, w0 * 0.7, dbulb) * 0.85))
    return colorize(a, fine)


def drag(seed):
    """끌린 자국 — 왼→오른쪽으로 몸이 끌리며 점점 옅어진다"""
    rng = np.random.default_rng(seed)
    n = fbm(rng); fine = fbm(np.random.default_rng(seed + 99), octaves=8, base=8, gain=0.62)
    a = np.zeros((S, S), np.float32)
    cy = S * 0.5
    wob = lambda x: np.sin(x * 0.011) * 14.0 + np.sin(x * 0.004 + 1.3) * 22.0
    x0, x1 = S * 0.10, S * 0.92
    for i in range(46):                                    # 본체 — 진행하며 작아지고 옅어진다
        t = i / 45.0
        px = x0 + (x1 - x0) * t
        py = cy + wob(px)
        rad = S * (0.135 * (1.0 - 0.72 * t))
        r = np.hypot((xx - px) / 1.25, (yy - py)) / max(rad, 1)
        m = (1.15 - r) + (n - 0.5) * 1.0 + (fine - 0.5) * 0.25
        a = np.maximum(a, smooth(0.500, 0.540, m) * (1.0 - 0.55 * t))
    for _ in range(rng.integers(26, 38)):                  # 긁힌 줄기
        off = (rng.random() - 0.5) * S * 0.20
        w = rng.random() * 2.2 + 0.7
        s0 = rng.random() * 0.35; s1 = s0 + 0.25 + rng.random() * 0.6
        xs = x0 + (x1 - x0) * s0; xe = min(x0 + (x1 - x0) * s1, x1)
        py = cy + wob(xx) + off + np.sin(xx * 0.03 + rng.random() * 6) * 3.0
        line = np.exp(-((yy - py) / w) ** 2) * smooth(xs - 6, xs + 8, xx) * smooth(xe + 10, xe - 20, xx)
        a = np.maximum(a, line * (0.35 + rng.random() * 0.5) * (1.0 - 0.5 * (xs - x0) / (x1 - x0)))
    for _ in range(rng.integers(90, 150)):                 # 튄 방울
        t = rng.random()
        px = x0 + (x1 - x0) * t + (rng.random() - 0.5) * S * 0.10
        py = cy + wob(px) + (rng.random() - 0.5) * S * 0.42
        rr = 1.0 + rng.random() ** 3.4 * 5.5; ex = 1.0 + rng.random() * 2.0
        d = np.hypot((xx - px) / ex, (yy - py))
        a = np.maximum(a, smooth(rr + 0.9, rr * 0.5, d) * (0.4 + rng.random() * 0.5))
    return colorize(a, fine)


if __name__ == '__main__':
    made = {'pool': blob(2400, 'pool'), 'splatter': blob(2401, 'splatter'), 'drag': drag(3311)}
    sheet = Image.new('RGB', (3 * 260, 262), (58, 62, 58))
    for i, (k, im) in enumerate(made.items()):
        p = os.path.join(OUT, f"decal_blood_{k}.webp")
        im.save(p, quality=92, method=5)
        print(f"{k:9s} {os.path.getsize(p)//1024:3d} KB  alpha={np.asarray(im)[...,3].mean()/255:.3f}  "
              f"rgb_max={np.asarray(im)[...,:3].max()}")
        s = im.resize((256, 256)); bg = Image.new('RGB', (256, 256), (74, 80, 74))
        bg.paste(s, (0, 0), s); sheet.paste(bg, (i * 260 + 2, 2))
    sheet.save('blood_preview.png')
    print(f"BRIGHT={BRIGHT}  preview -> blood_preview.png")
