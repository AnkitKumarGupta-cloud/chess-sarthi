# Make test screenshots: a board (various piece sets / colours / sizes / flipped) inside a busy page, with the true position.
import json, random, os, sys, base64
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
FENS = ["r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR", "6k1/5ppp/8/8/8/8/5PPP/3R2K1", "r4rk1/pp3ppp/2n1b3/q1pp4/3P4/P1PBPN2/1P3PPP/R2QK2R",
        "8/2k5/3p4/p2P1p2/P2P1P2/8/3K4/8", "2r3k1/5pp1/p2q3p/1p1Bp3/1P2P3/P4Q1P/5PP1/3R2K1", "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR",
        "r2q1rk1/1b2bppp/p2p1n2/npp1p3/3PP3/2P2N1P/PPBN1PP1/R1BQR1K1", "4r1k1/1p3pp1/p1n4p/2p5/2P2B2/P4N1P/1P3PP1/4R1K1"]
THEMES = [("#f0d9b5", "#b58863"), ("#eeeed2", "#769656"), ("#dee3e6", "#8ca2ad"), ("#e8d0aa", "#b07a4d"), ("#ebecd0", "#739552"), ("#f0d9b5", "#946f51")]
SETS = sys.argv[2].split(",") if len(sys.argv) > 2 else ["cburnett", "merida", "alpha", "staunty", "california", "maestro", "pirouetti", "governor"]

def b64(p): return "data:image/svg+xml;base64," + base64.b64encode(open(p, "rb").read()).decode()

def page(fen, pset, theme, size, flip, hl, coords, tex=None):
    rows = fen.split("/"); grid = []
    for r in rows:
        line = []
        for ch in r:
            if ch.isdigit(): line += [""] * int(ch)
            else: line.append(ch)
        grid.append(line)
    if flip: grid = [row[::-1] for row in grid[::-1]]
    cells = []
    for i in range(8):
        for j in range(8):
            col = "transparent" if tex else theme[(i + j) % 2]
            if (i, j) in hl: col = "#cdd26a" if (i + j) % 2 == 0 else "#aaa23a"
            p = grid[i][j]; img = ""
            if p:
                n = ("w" if p.isupper() else "b") + p.upper()
                img = f'<img src="{b64(os.path.join(HERE, "lila/public/piece", pset, n + ".svg"))}" style="width:100%;height:100%">'
            co = ""
            if coords and j == 0: co += f'<span style="position:absolute;left:2px;top:1px;font:600 11px sans-serif;color:{theme[(i+j+1)%2]}">{(i+1) if flip else 8-i}</span>'
            if coords and i == 7: co += f'<span style="position:absolute;right:2px;bottom:0;font:600 11px sans-serif;color:{theme[(i+j+1)%2]}">{"hgfedcba"[j] if flip else "abcdefgh"[j]}</span>'
            cells.append(f'<div style="position:relative;background:{col}">{img}{co}</div>')
    side = "".join(f"<p>{random.choice(['1. e4 e5','Nf3 Nc6','Bb5 a6','Your turn','Find the best move for white','Rating 1500'])}</p>" for _ in range(12))
    return f"""<html><body style="margin:0;background:#262421;color:#bababa;font:15px sans-serif;display:flex;gap:30px;padding:40px">
<div style="width:220px">{side}</div>
<div style="width:{size}px;height:{size}px;{('background:url('+tex+') 0 0/100% 100%;') if tex else ''}display:grid;grid-template-columns:repeat(8,1fr);grid-template-rows:repeat(8,1fr);flex:none">{''.join(cells)}</div>
<div style="width:300px;background:#302e2c;padding:10px">{side}</div></body></html>"""

if __name__ == "__main__":
    out = sys.argv[1]; os.makedirs(out, exist_ok=True); random.seed(5); truth = []
    TEX = [t for t in os.environ.get("TEX", "").split(",") if t]
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1600, "height": 900})
        for k in range(len(SETS) * 3 if not TEX else len(TEX)):
            fen = FENS[k % len(FENS)]; pset = SETS[k % len(SETS)]; theme = THEMES[k % len(THEMES)]
            size = random.choice([320, 400, 520, 640, 760]); flip = k % 3 == 2
            hl = {(random.randrange(8), random.randrange(8)) for _ in range(2)}
            tex = None
            if TEX:
                tp = os.path.join(HERE, "lila/public/images/board", TEX[k]); ext = tp.rsplit(".", 1)[1]
                tex = f"data:image/{'jpeg' if ext == 'jpg' else ext};base64," + base64.b64encode(open(tp, "rb").read()).decode()
            pg.set_content(page(fen, pset, theme, size, flip, hl, k % 2 == 0, tex))
            f = os.path.join(out, f"s{k:02d}.png"); pg.screenshot(path=f)
            truth.append({"file": f, "fen": fen, "flip": flip, "set": pset, "size": size})
        br.close()
    json.dump(truth, open(os.path.join(out, "truth.json"), "w"), indent=1)
    print(len(truth), "shots")
