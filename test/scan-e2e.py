# "My screen" in the class Puzzle panel, end to end in Chromium (no real class needed).
#   npx vite --port 5179 &      then      python3 test/scan-e2e.py
# The teacher's "screen" is a screenshot from test/fixtures/scan, given to the page as a fake screen share.
# Checks: the board is found, every square is read (or fixed with the piece buttons), the position is sent to the students.
import base64, os, sys, json
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
URL = os.environ.get("HARNESS", "http://localhost:5179/test/harness/puzzle.html")
CASES = [
    ("board-flipped.png", "r4rk1/pp3ppp/2n1b3/q1pp4/3P4/P1PBPN2/1P3PPP/R2QK2R", True),
    ("board-textured.png", "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR", True),
]
FAKE_SCREEN = """
window.__screen = null;
navigator.mediaDevices.getDisplayMedia = async () => {
  const img = new Image(); img.src = window.__screen; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); const draw = () => g.drawImage(img, 0, 0); draw(); setInterval(draw, 100);
  return c.captureStream(10);
};
"""

def screen_of(fen, flipped):
    rows = []
    for r in fen.split("/"):
        row = []
        for ch in r: row += [""] * int(ch) if ch.isdigit() else [ch]
        rows.append(row)
    sq = [p for row in rows for p in row]
    return sq[::-1] if flipped else sq

def read_board(pg):
    out = []
    for lab in pg.locator(".scanb .pzsq").evaluate_all("els => els.map(e => e.getAttribute('aria-label'))"):
        parts = lab.split(",")[0].split(" ")
        if parts[1] == "empty": out.append("")
        else:
            t = {"king": "k", "queen": "q", "rook": "r", "bishop": "b", "knight": "n", "pawn": "p", "k": "k", "q": "q", "r": "r", "b": "b", "n": "n", "p": "p"}[parts[2]]
            out.append(t.upper() if parts[1] == "White" else t)
    return out

ok = True
with sync_playwright() as p:
    br = p.chromium.launch()
    for fname, fen, flipped in CASES:
        pg = br.new_page(viewport={"width": 1400, "height": 1000})
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.add_init_script(FAKE_SCREEN)
        pg.goto(URL)
        data = base64.b64encode(open(os.path.join(HERE, "fixtures/scan", fname), "rb").read()).decode()
        pg.evaluate("d => window.__screen = 'data:image/png;base64,' + d", data)
        t = pg.locator("#tcol")
        t.get_by_role("tab", name="My screen").click()
        t.get_by_role("button", name="Read the board").click()
        t.get_by_text("Check the position").wait_for(timeout=30000)
        want = screen_of(fen, flipped); got = read_board(pg)
        wrong = [i for i in range(64) if got[i] != want[i]]
        bottom = "Black" if pg.locator(".scan-opts").first.get_by_role("radio", name="Black").get_attribute("aria-checked") == "true" else "White"
        print(f"{fname}: read {64 - len(wrong)}/64 squares, bottom side {bottom} (want {'Black' if flipped else 'White'})")
        if bottom != ("Black" if flipped else "White"):
            pg.locator(".scan-opts").first.get_by_role("radio", name="Black" if flipped else "White").click()
        # fix wrong squares with the piece buttons
        names = {"k": "king", "q": "queen", "r": "rook", "b": "bishop", "n": "knight", "p": "pawn"}
        for i in wrong:
            w = want[i]
            title = "Empty square" if not w else ("White " if w.isupper() else "Black ") + names[w.lower()]
            t.locator(f".scan-tool[title='{title}']").click()
            pg.locator(".scanb .pzsq").nth(i).click()
        if read_board(pg) != want: print("  FAIL: board still wrong after fixing"); ok = False; continue
        # who moves: White
        pg.locator(".scan-opts").nth(1).get_by_role("radio", name="White").click()
        t.get_by_role("button", name="Use this position").click()
        # play an answer on the teacher's board (any legal first move), then send
        board = t.locator(".pzb").first
        moved = False
        for i in range(64):
            sq = board.locator(".pzsq").nth(i); sq.click()
            dests = board.locator(".dotm, .cap")
            if dests.count():
                dests.first.locator("xpath=..").click(); moved = True; break
        if not moved: print("  FAIL: couldn't play a move"); ok = False; continue
        t.get_by_role("button", name="Send to class").click()
        pg.wait_for_timeout(300)
        sent = [m for m in pg.evaluate("window.__log") if m["msg"].get("t") == "start"]
        fen_sent = sent[-1]["msg"]["fen"] if sent else ""
        good = fen_sent.split(" ")[0] == fen and fen_sent.split(" ")[1] == "w"
        print(f"  sent: {fen_sent}  {'OK' if good else 'FAIL'}; page errors: {errs or 'none'}")
        ok = ok and good and not errs
        pg.screenshot(path=f"/tmp/scan-{fname}")
    br.close()
print("ALL OK" if ok else "FAILED"); sys.exit(0 if ok else 1)
