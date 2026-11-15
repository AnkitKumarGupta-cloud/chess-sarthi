# Synthetic chess-square images for training the screen board reader.
# usage: python3 gen.py OUT.npz N SETS(comma list or "train"/"val") SEED
import sys, os, io, random, glob
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
VAL_SETS = ["alpha", "california", "staunty", "maestro", "fresca", "tatiana"]
ALL = sorted(os.listdir(os.path.join(HERE, "png")))
CLASSES = ["e", "wP", "wN", "wB", "wR", "wQ", "wK", "bP", "bN", "bB", "bR", "bQ", "bK"]
S = 96

def load_sets(names):
    out = []
    for s in names:
        d = {}
        for c in CLASSES[1:]:
            im = Image.open(os.path.join(HERE, "png", s, c + ".png")).convert("RGBA")
            d[c] = im
        out.append(d)
    return out

BOARDS = []
for f in glob.glob(os.path.join(HERE, "lila/public/images/board/*")):
    n = os.path.basename(f)
    if any(k in n for k in ("thumbnail", "orig", "last-move", "premove", "dest", "selected")):
        continue
    try:
        im = Image.open(f).convert("RGB")
        if im.width >= 256: BOARDS.append(im)
    except Exception:
        pass

# common flat themes (light, dark): lichess brown/blue/green, chess.com green/brown, our app, plus random
FLAT = [((240, 217, 181), (181, 136, 99)), ((222, 227, 230), (140, 162, 173)), ((255, 255, 221), (134, 166, 102)),
        ((235, 236, 208), (115, 149, 82)), ((237, 214, 176), (184, 135, 98)), ((238, 238, 210), (118, 150, 86)),
        ((240, 217, 181), (176, 128, 92)), ((232, 235, 239), (125, 135, 150)), ((234, 233, 210), (75, 115, 153)),
        ((255, 206, 158), (209, 139, 71))]
FONT = None
for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]:
    if os.path.exists(p): FONT = p; break

def jitter(c, a=18):
    return tuple(int(min(255, max(0, v + random.randint(-a, a)))) for v in c)

def square_colors():
    r = random.random()
    if r < 0.55:
        l, d = random.choice(FLAT); return ("flat", jitter(l, 12), jitter(d, 12))
    if r < 0.8 and BOARDS:
        return ("tex", random.choice(BOARDS), None)
    # random pair, light clearly lighter than dark
    base = [random.randint(60, 200) for _ in range(3)]
    l = tuple(min(255, v + random.randint(40, 90)) for v in base)
    return ("flat", l, tuple(base))

def cell_bg(theme, light, size, idx):
    kind, a, b = theme
    if kind == "flat":
        return Image.new("RGB", (size, size), a if light else b)
    tex = a.resize((size * 8, size * 8))
    # pick a cell of the board picture with the right colour
    while True:
        i, j = random.randrange(8), random.randrange(8)
        if ((i + j) % 2 == 0) == light: break
    return tex.crop((i * size, j * size, (i + 1) * size, (j + 1) * size))

def sample(sets):
    cls = 0 if random.random() < 0.33 else random.randrange(1, 13)
    light = random.random() < 0.5
    theme = square_colors()
    # 3x3 neighbourhood so that slight misalignment shows neighbour colours
    big = Image.new("RGB", (3 * S, 3 * S))
    for i in range(3):
        for j in range(3):
            l = light if (i + j) % 2 == 0 else not light
            big.paste(cell_bg(theme, l, S, 0), (i * S, j * S))
    d = ImageDraw.Draw(big, "RGBA")
    # highlight (last move / selected / check)
    hr = random.random()
    if hr < 0.18:
        col = random.choice([(205, 210, 106), (155, 199, 0), (20, 85, 30), (246, 246, 105), (186, 202, 68), (100, 160, 220)])
        d.rectangle((S, S, 2 * S - 1, 2 * S - 1), fill=col + (random.randint(80, 170),))
    elif hr < 0.22 and cls in (6, 12):
        d.ellipse((S + 5, S + 5, 2 * S - 5, 2 * S - 5), fill=(255, 0, 0, 120))
    # neighbour pieces peeking in
    if random.random() < 0.3:
        st = random.choice(sets); k = random.choice(CLASSES[1:])
        pi = st[k].resize((S, S)); big.paste(pi, (random.choice([0, 2]) * S, S), pi)
    if cls:
        st = random.choice(sets); pi = st[CLASSES[cls]]
        sc = random.uniform(0.78, 1.02); ps = int(S * sc)
        pi = pi.resize((ps, ps), Image.LANCZOS)
        ox = S + (S - ps) // 2 + int(random.uniform(-0.04, 0.04) * S)
        oy = S + (S - ps) // 2 + int(random.uniform(-0.04, 0.04) * S)
        if random.random() < 0.08:  # piece being faded (premove ghost) - rare
            a = np.array(pi); a[..., 3] = (a[..., 3] * 0.5).astype(np.uint8); pi = Image.fromarray(a)
        big.paste(pi, (ox, oy), pi)
    elif random.random() < 0.08:  # move-destination dot
        r = random.randint(S // 8, S // 5)
        d.ellipse((1.5 * S - r, 1.5 * S - r, 1.5 * S + r, 1.5 * S + r), fill=(20, 85, 30, 120))
    if random.random() < 0.25 and FONT:  # coordinate letter in a corner
        f = ImageFont.truetype(FONT, random.randint(10, 18))
        t = random.choice("abcdefgh12345678")
        pos = random.choice([(S + 3, S + 2), (2 * S - 14, 2 * S - 20)])
        d.text(pos, t, font=f, fill=(random.choice([40, 200]),) * 3 + (230,))
    # crop with misalignment
    c = S * random.uniform(0.93, 1.07); cx = 1.5 * S + random.uniform(-0.06, 0.06) * S; cy = 1.5 * S + random.uniform(-0.06, 0.06) * S
    im = big.crop((int(cx - c / 2), int(cy - c / 2), int(cx + c / 2), int(cy + c / 2)))
    # screen-share loss: low resolution, blur, video/JPEG compression
    r = random.randint(16, 64)
    im = im.resize((r, r), Image.BOX if random.random() < 0.5 else Image.BILINEAR)
    if random.random() < 0.6:
        b = io.BytesIO(); im.save(b, "JPEG", quality=random.randint(20, 92)); im = Image.open(io.BytesIO(b.getvalue())).convert("RGB")
    im = im.resize((32, 32), Image.BILINEAR)
    a = np.asarray(im).astype(np.float32)
    a = a * random.uniform(0.8, 1.15) + random.uniform(-20, 20) + np.random.normal(0, random.uniform(0, 4), a.shape)
    return np.clip(a, 0, 255).astype(np.uint8), cls

if __name__ == "__main__":
    out, n, which, seed = sys.argv[1], int(sys.argv[2]), sys.argv[3], int(sys.argv[4])
    random.seed(seed); np.random.seed(seed)
    names = [s for s in ALL if s not in VAL_SETS] if which == "train" else VAL_SETS if which == "val" else which.split(",")
    sets = load_sets(names)
    X = np.zeros((n, 32, 32, 3), np.uint8); Y = np.zeros(n, np.int64)
    for i in range(n):
        X[i], Y[i] = sample(sets)
    np.savez_compressed(out, X=X, Y=Y)
    print(out, n, len(names), "sets", len(BOARDS), "board pictures")
