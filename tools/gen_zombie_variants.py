"""좀비 옷 변형 생성기 — 같은 메시에 텍스처만 갈아끼운다 (성능 비용 0)

  python gen_zombie_variants.py

입력: GLB 안의 diffuse 2장 (zombie_body_diffuse, zombie_diffuse)
출력: public/assets/textures/zombie_{coat,scrub}_{body,}.webp

방식 — UV 아일랜드를 좌표로 일일이 찍는 대신 색으로 분류한다.
  · 얼굴·머리카락 영역만 좌표로 보호 (거기서 색 분류를 하면 피부가 옷으로 잡힌다)
  · 채도 낮고 밝은 픽셀 = 천 → 흰 가운으로
  · 갈색 계열 어두운 픽셀 = 바지/속옷 → 수술복 청록으로
  · 채도 높은 붉은 픽셀 = 피 → 손대지 않는다
그리고 가운 아랫단·소매에 핏자국을 덧그린다.
"""
import json, struct, io, os
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # 저장소 루트 (tools/ 의 부모)
GLB = os.path.join(ROOT, "public/assets/models/zombie_shambler.glb")
OUT = os.path.join(ROOT, "public/assets/textures/characters")
SIZE = 1024

# 정규화 좌표(0~1)로 보호할 영역 — 얼굴 / 머리카락 / 눈알
PROTECT = [
    (0.03, 0.00, 0.30, 0.27),   # 얼굴
    (0.28, 0.00, 0.42, 0.23),   # 눈·뒤통수 조각
    (0.56, 0.00, 0.79, 0.27),   # 머리카락
]
FACE = (0.03, 0.00, 0.30, 0.27)

# 옷에 피를 덧바를 영역 (가운 아랫단·소매 근처)
BLOOD_RECTS = [
    (0.28, 0.24, 0.53, 0.36),
    (0.47, 0.50, 0.66, 0.79),
    (0.00, 0.63, 0.30, 0.94),
]


def load_glb_images():
    d = open(GLB, 'rb').read()
    off, js, bin_ = 12, None, None
    while off < len(d):
        clen, ct = struct.unpack('<I4s', d[off:off + 8]); off += 8
        if ct == b'JSON': js = json.loads(d[off:off + clen])
        elif ct == b'BIN\x00': bin_ = d[off:off + clen]
        off += clen
    out = {}
    for im in js['images']:
        v = js['bufferViews'][im['bufferView']]
        st = v.get('byteOffset', 0)
        raw = bin_[st:st + v['byteLength']]
        out[im.get('name', '')] = Image.open(io.BytesIO(raw)).convert('RGB')
    return out


def rgb_to_hsv(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx, mn = a.max(-1), a.min(-1)
    df = mx - mn + 1e-8
    h = np.zeros_like(mx)
    m = (mx == r); h[m] = ((g - b)[m] / df[m]) % 6
    m = (mx == g); h[m] = ((b - r)[m] / df[m]) + 2
    m = (mx == b); h[m] = ((r - g)[m] / df[m]) + 4
    return h * 60.0, np.where(mx > 0, df / (mx + 1e-8), 0), mx


def hsv_to_rgb(h, s, v):
    h = (h % 360) / 60.0
    i = np.floor(h).astype(int) % 6
    f = h - np.floor(h)
    p, q, t = v * (1 - s), v * (1 - s * f), v * (1 - s * (1 - f))
    out = np.zeros(h.shape + (3,), np.float32)
    for k, (R, G, B) in enumerate([(v, t, p), (q, v, p), (p, v, t),
                                   (p, q, v), (t, p, v), (v, p, q)]):
        m = i == k
        out[m] = np.stack([R, G, B], -1)[m]
    return out


def rect_mask(shape, r):
    H, W = shape
    m = np.zeros((H, W), bool)
    m[int(r[1] * H):int(r[3] * H), int(r[0] * W):int(r[2] * W)] = True
    return m


def fbm(rng, S, octaves=6, base=4, gain=0.55):
    acc = np.zeros((S, S), np.float32); amp, tot = 1.0, 0.0
    for o in range(octaves):
        n = min(base * 2 ** o, S)
        g = rng.random((n, n)).astype(np.float32)
        im = Image.fromarray((g * 255).astype(np.uint8)).resize((S, S), Image.BICUBIC)
        acc += np.asarray(im, np.float32) / 255.0 * amp; tot += amp; amp *= gain
    return acc / tot


def recolor(img, mode, seed):
    """mode: 'coat' 흰 가운 / 'scrub' 수술복 청록"""
    a = np.asarray(img.resize((SIZE, SIZE), Image.LANCZOS), np.float32) / 255.0
    h, s, v = rgb_to_hsv(a)

    protect = np.zeros((SIZE, SIZE), bool)
    for r in PROTECT:
        protect |= rect_mask((SIZE, SIZE), r)

    blood = (((h < 18) | (h > 340)) & (s > 0.33))          # 피는 건드리지 않는다
    cloth_light = (s < 0.24) & (v > 0.30) & ~protect & ~blood
    cloth_dark = (h > 8) & (h < 55) & (s > 0.18) & (v < 0.62) & ~protect & ~blood

    h2, s2, v2 = h.copy(), s.copy(), v.copy()
    if mode == 'coat':
        # 밝은 천 → 흰 가운. 채도를 죽이고 밝기를 올린다
        s2[cloth_light] = s[cloth_light] * 0.30
        v2[cloth_light] = np.clip(v[cloth_light] * 1.28 + 0.10, 0, 1.0)
        h2[cloth_light] = 205                                   # 아주 옅은 한기
        # 어두운 천 → 수술복 하의(청록)
        h2[cloth_dark] = 200                                    # 청회색 수술복 하의
        s2[cloth_dark] = np.clip(s[cloth_dark] * 0.5 + 0.05, 0, 0.22)
    else:
        # 전신 수술복 — 밝은 천도 청록으로
        h2[cloth_light] = 168
        s2[cloth_light] = np.clip(s[cloth_light] + 0.16, 0, 0.26)   # 바랜 수술복
        v2[cloth_light] = np.clip(v[cloth_light] * 0.80, 0, 1.0)
        h2[cloth_dark] = 166
        s2[cloth_dark] = np.clip(s[cloth_dark] * 0.6 + 0.08, 0, 0.28)

    # 얼굴 창백하게 — 채도를 빼고 살짝 어둡게
    face = rect_mask((SIZE, SIZE), FACE) & ~blood
    s2[face] = s[face] * 0.55
    v2[face] = np.clip(v[face] * 0.92, 0, 1)

    out = hsv_to_rgb(h2, s2, v2)

    # 가운 아랫단·소매에 핏자국 덧바르기
    rng = np.random.default_rng(seed)
    n = fbm(rng, SIZE)
    yy, xx = np.mgrid[0:SIZE, 0:SIZE].astype(np.float32)
    stain = np.zeros((SIZE, SIZE), np.float32)
    for ri, r in enumerate(BLOOD_RECTS):
        m = rect_mask((SIZE, SIZE), r)
        for _ in range(rng.integers(3, 6)):
            cx = rng.uniform(r[0], r[2]) * SIZE
            cy = rng.uniform(r[1] + (r[3] - r[1]) * 0.35, r[3]) * SIZE
            rad = SIZE * rng.uniform(0.025, 0.06)
            d = np.hypot(xx - cx, yy - cy) / rad
            blob = np.clip(1.25 - d + (n - 0.5) * 1.1, 0, 1)
            stain = np.maximum(stain, np.where(m, np.clip((blob - 0.45) * 3.0, 0, 1), 0))
    stain *= 0.72
    blood_col = np.array([0.20, 0.045, 0.038], np.float32)
    out = out * (1 - stain[..., None]) + blood_col * stain[..., None]

    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8))


if __name__ == '__main__':
    imgs = load_glb_images()
    pairs = [('zombie_body_diffuse', 'body'), ('zombie_diffuse', 'main')]
    sheet = Image.new('RGB', (3 * 344, 350), (18, 18, 18))
    for mi, mode in enumerate(['coat', 'scrub']):
        for src, tag in pairs:
            im = recolor(imgs[src], mode, 900 + mi * 7)
            p = os.path.join(OUT, f"zombie_{mode}_{tag}.webp")
            im.save(p, quality=80, method=5)
            print(f"{mode:6s} {tag:5s} -> {os.path.getsize(p)//1024:4d} KB")
            if tag == 'main':
                sheet.paste(im.resize((340, 340)), ((mi + 1) * 344 + 2, 4))
    sheet.paste(imgs['zombie_diffuse'].resize((340, 340)), (2, 4))
    from PIL import ImageDraw
    d = ImageDraw.Draw(sheet)
    for i, t in enumerate(['원본', 'coat 가운', 'scrub 수술복']):
        d.text((i * 344 + 8, 330), t, fill=(255, 235, 120))
    sheet.save(os.path.join(ROOT, 'variants_preview.png'))
    print('preview -> variants_preview.png')
