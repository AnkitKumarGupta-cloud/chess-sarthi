# End-to-end tests for the score-sheet reader, with the three reader calls mocked.
#   npm run build && node test/dev-server.mjs &   then   python3 test/reader-e2e.py
# Needs: pip install playwright pillow, and Chrome at /usr/bin/google-chrome (or set CHROME).
import json, os, sys, time, io, tempfile
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright
BASE = os.environ.get("BASE", "http://localhost:4173"); URL = BASE + "/reader/"
HERE = os.path.dirname(os.path.abspath(__file__)); FIX = json.load(open(os.path.join(HERE, "fixtures", "reader-result.json")))
TMP = tempfile.mkdtemp()
def photo(name, w=1800, h=2400, fmt="JPEG"):
    im = Image.new("RGB", (w, h), "#f7f3e8"); d = ImageDraw.Draw(im)
    for i in range(30): d.line([(80, 200 + i * 70), (w - 80, 200 + i * 70)], fill="#999", width=2); d.text((100, 170 + i * 70), f"{i+1}.  move  move", fill="#222")
    p = os.path.join(TMP, name); im.save(p, fmt); return p
JPG = photo("sheet.jpg"); PNG = photo("page2.png", fmt="PNG")
def raw(name, data): p = os.path.join(TMP, name); open(p, "wb").write(data); return p
TXT = raw("notes.jpg", b"this is not a photo"); EMPTY = raw("empty.jpg", b""); PDF = raw("sheet.pdf", b"%PDF-1.4 fake"); SVG = raw("x.svg", b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>")
sse = lambda ev, data: f"event: generating\ndata: null\n\nevent: {ev}\ndata: {data}\n\n"
OK = 0; FAILS = []
def check(name, cond, extra=""):
    global OK
    if cond: OK += 1
    else: FAILS.append(name + (" :: " + str(extra) if extra else "")); print("FAIL", name, extra)

class Mock:
    def __init__(self, ctx, result=FIX, upload=200, call=None, stream=None, abort=None, delay=0):
        self.n = {"upload": 0, "call": 0, "get": 0}; self.r = result; self.upload = upload; self.call = call; self.stream = stream; self.abort = abort; self.delay = delay
        ctx.route("**/*.hf.space/**", self.handle)
    def handle(self, route):
        u = route.request.url
        if self.abort and self.abort in u: return route.abort()
        if u.endswith("/gradio_api/upload"):
            self.n["upload"] += 1
            if self.delay: time.sleep(self.delay)
            return route.fulfill(status=self.upload, content_type="application/json", body=json.dumps(["/tmp/gradio/x/sheet.jpg"]) if self.upload == 200 else "Internal Server Error")
        if u.endswith("/gradio_api/call/read"):
            self.n["call"] += 1
            body = route.request.post_data_json
            assert body["data"][0]["path"] == "/tmp/gradio/x/sheet.jpg" and body["data"][0]["meta"]["_type"] == "gradio.FileData"
            return route.fulfill(status=200, content_type="application/json", body=json.dumps(self.call if self.call is not None else {"event_id": "abc123"}))
        if "/gradio_api/call/read/abc123" in u:
            self.n["get"] += 1
            return route.fulfill(status=200, content_type="text/event-stream", body=self.stream if self.stream is not None else sse("complete", json.dumps([self.r])))
        return route.fulfill(status=404, body="?")

def new(b, w=390, h=800, mobile=True, role="student", **mock):
    ctx = b.new_context(viewport={"width": w, "height": h}, is_mobile=mobile, has_touch=mobile)
    ctx.add_init_script("if(!localStorage.getItem('targetchess.v2'))localStorage.setItem('targetchess.v2', JSON.stringify({liveToken:'t',liveUser:{username:'u',name:'U',role:'%s'}}))" % role)
    m = Mock(ctx, **mock); pg = ctx.new_page(); pg.errs = []; pg.dialogs = []
    pg.on("pageerror", lambda e: pg.errs.append(str(e))); pg.on("console", lambda c: c.type == "error" and pg.errs.append(c.text))
    pg.on("dialog", lambda d: (pg.dialogs.append(d.message), d.accept()))
    pg.goto(URL); pg.wait_for_selector("#rdRead"); return ctx, pg, m
def read(pg, files=None, wait="#rdResult"):
    pg.set_input_files("#rdFile", files or JPG); pg.click("#rdRead")
    if wait: pg.wait_for_selector(wait, timeout=15000)
status = lambda pg: pg.inner_text("#rdStatus")
def wait(pg, expr, timeout=15000):          # the page's CSP forbids eval, so poll from outside instead of wait_for_function
    end = time.time() + timeout / 1000
    while time.time() < end:
        if pg.evaluate(expr): return True
        pg.wait_for_timeout(100)
    raise TimeoutError(expr)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get("CHROME", "/usr/bin/google-chrome"), args=["--no-sandbox"])

    # 1. happy path (phone, 390 wide)
    ctx, pg, m = new(b)
    read(pg)
    check("summary 26 of 60", "26 of 60 moves legal" in pg.inner_text("#rdSummary"), pg.inner_text("#rdSummary"))
    check("summary parts", all(x in pg.inner_text("#rdSummary") for x in ["1 cannot be played", "33 not checkable yet", "6 unsure"]), pg.inner_text("#rdSummary"))
    check("header", "60 moves · 1 page" in pg.inner_text("#rdResult h2"))
    check("names", pg.input_value(".rd-fields input >> nth=1") == "Aarav S")
    check("one upload one read", m.n == {"upload": 1, "call": 1, "get": 1}, m.n)
    chip = pg.locator(".rd-chip.bad"); check("bad chip text", chip.inner_text() == "14.Qf4 ✗", chip.inner_text())
    chip.click(); check("review title", "Check move 14." in pg.inner_text("#rdCheck"))
    check("review reason", "Cannot be played" in pg.inner_text("#rdReview") and "confidence 41%" in pg.inner_text("#rdReview"))
    check("photo shown", pg.evaluate("document.querySelector('.sv-img').naturalWidth") > 0)
    check("photo resized for viewer", pg.evaluate("document.querySelector('.sv-img').naturalHeight") == 2400)
    check("small board", pg.locator("#rdReview .rd-board .sq").count() == 64)
    pg.click("#rdUse"); check("empty input message", "Type a move first." in pg.inner_text("#rdReview"))
    pg.fill("#rdMove", "Rfd1"); pg.press("#rdMove", "Enter")
    check("after fix 33 of 60", "33 of 60 moves legal" in pg.inner_text("#rdSummary"), pg.inner_text("#rdSummary"))
    check("changed chip", pg.locator(".rd-chip", has_text="14.Qf4→Rfd1").inner_text() == "14.Qf4→Rfd1 ✎ ✓", pg.locator(".rd-chip", has_text="14.Qf4").inner_text())
    check("pgn has written note", "Rfd1 {written: Qf4}" in pg.inner_text("#rdPgn"))
    check("pgn stops", "gxf3" not in pg.inner_text("#rdPgn") and "Annotator" in pg.inner_text("#rdPgn"))
    check("moves to next review", "Check move" in pg.inner_text("#rdCheck") and "14." not in pg.inner_text("#rdCheck"), pg.inner_text("#rdCheck"))
    check("decisions list", "Your decisions (1)" in pg.inner_text("#rdReview"))
    check("analysis board", pg.locator("#rdOutput .rd-board.big .sq").count() == 64 and pg.locator("#rdLine li").count() == 33)
    # suggestion button on the next illegal move (17...ef4 -> exf3), then everything is legal
    pg.locator(".rd-chip.bad").click(); pg.locator(".rd-sug button", has_text="exf3").click()
    check("all legal after second fix", "60 of 60 moves legal" in pg.inner_text("#rdSummary"), pg.inner_text("#rdSummary"))
    pg.locator(".rd-dec summary").first.click(); pg.locator(".rd-dec li button", has_text="Undo").first.click()
    check("undo", "26 of 60 moves legal" in pg.inner_text("#rdSummary"))
    w = pg.evaluate("document.documentElement.scrollWidth"); check("no sideways scroll at 390", w <= 390, w)
    check("no console errors (happy)", pg.errs == [], pg.errs)
    check("no stray null text", "null" not in pg.inner_text("#app").split("[Event")[0])
    # reload mid-review -> draft resumes with photo
    pg.locator(".rd-chip.bad").click(); pg.fill("#rdMove", "Rfd1"); pg.click("#rdUse")
    pg.reload(); pg.wait_for_selector("#rdResume"); pg.locator("#rdResume button", has_text="Continue").click(); pg.wait_for_selector("#rdResult")
    check("resume keeps fixes", "60 of 60 moves legal" in pg.inner_text("#rdSummary") and "14.Qf4→Rfd1" in pg.inner_text("#rdChips"), pg.inner_text("#rdSummary"))
    wait(pg, "document.querySelector('.sv-img') && document.querySelector('.sv-img').naturalWidth>0", timeout=5000)
    check("resume keeps photo", True)
    # full screen: Back / X / Escape
    def full_open():
        pg.locator(".sv-b", has_text="Full screen").click(); pg.wait_for_selector("#rdFull")
    def closed(): return pg.locator("#rdFull").count() == 0 and not pg.evaluate("document.body.classList.contains('fs-open')") and pg.url.rstrip("/").endswith("/reader")
    full_open(); check("full has header+box", "Check move" in pg.inner_text(".rd-full-h") and pg.locator("#rdFull #rdMove").count() == 1 and pg.evaluate("document.body.classList.contains('fs-open')"))
    pg.go_back(); pg.wait_for_timeout(300); check("Back closes full screen", closed() and pg.locator("#rdResult").count() == 1)
    full_open(); pg.click("#rdFullClose"); pg.wait_for_timeout(300); check("X closes", closed())
    full_open(); pg.keyboard.press("Escape"); pg.wait_for_timeout(300); check("Escape closes", closed())
    full_open(); before = pg.inner_text(".rd-full-h b"); pg.click("#rdFull #rdAccept"); pg.wait_for_timeout(200)
    check("Use in full screen stays and moves on", pg.locator("#rdFull").count() == 1 and pg.inner_text(".rd-full-h b") != before, pg.inner_text(".rd-full-h b") if pg.locator("#rdFull").count() else "closed")
    pg.set_viewport_size({"width": 800, "height": 390}); pg.wait_for_timeout(200)
    r = pg.evaluate("(()=>{const a=document.querySelector('#rdFull .sv-win').getBoundingClientRect(),i=document.querySelector('#rdFull #rdMove').getBoundingClientRect();return [a.height,i.top,i.bottom,innerHeight,document.querySelector('#rdFull').scrollHeight]})()")
    check("rotate: photo and box usable", r[0] >= 120 and (r[2] <= r[3] or r[4] > r[3]), r)
    pg.set_viewport_size({"width": 390, "height": 800}); pg.go_back(); pg.wait_for_timeout(200)
    # zoom + anchor, download, save, start over
    pg.locator(".sv-b", has_text="+").click(); pg.locator(".sv-b", has_text="+").click()
    w0 = 2.25 * pg.evaluate("document.querySelector('.sv-win').clientHeight") * 0.75; w1 = pg.evaluate("parseFloat(document.querySelector('.sv-img').style.width)"); check("zoom works", abs(w1 - w0) < 3, (w0, w1))
    box = pg.locator(".sv-win").bounding_box(); pg.mouse.move(box["x"] + 100, box["y"] + 100); pg.mouse.down(); pg.mouse.move(box["x"] + 60, box["y"] + 40, steps=4); pg.mouse.up()
    pg.click("#rdAccept"); check("anchor stored", pg.evaluate("JSON.parse(localStorage.getItem('cs-reader.draft')).anchors.length") == 1)
    with pg.expect_download() as dl: pg.click("#rdDownload")
    check("download name", dl.value.suggested_filename == "Aarav-S_vs_Rohan-K.pgn", dl.value.suggested_filename)
    pg.click("#rdSave"); check("saved game listed", pg.locator("#rdGames li").count() == 1)
    pg.click("#rdAnalyse"); wait(pg, "document.querySelector('#rdEngine') && /best move|could not/.test(document.querySelector('#rdEngine').textContent)", timeout=30000)
    check("engine gives a line", "best move" in pg.inner_text("#rdEngine"), pg.inner_text("#rdEngine"))
    pg.click("#rdStartOver"); pg.wait_for_timeout(300)
    check("start over clears", pg.locator("#rdResult").count() == 0 and pg.evaluate("localStorage.getItem('cs-reader.draft')") is None and len(pg.dialogs) == 1)
    check("no console errors (session)", pg.errs == [], pg.errs)
    ctx.close()

    # 2. two pages + add page merge
    half1 = dict(FIX, moves=FIX["moves"][:30]); ctx, pg, m = new(b, result=half1)
    read(pg); check("page 1: 30 moves", "30 moves · 1 page" in pg.inner_text("#rdResult h2"))
    m.r = dict(FIX, moves=FIX["moves"][28:]); pg.set_input_files("#rdAddFile", PNG); wait(pg, "document.querySelector('#rdResult h2').textContent.includes('2 pages')", timeout=15000)
    check("merged 60", "60 moves · 2 pages" in pg.inner_text("#rdResult h2")); check("dupes notice", "2 moves appeared on two pages" in pg.inner_text("body"))
    check("page tabs", pg.locator(".sv-tab").count() == 2); check("uploads 2", m.n["upload"] == 2); ctx.close()

    # 3. errors
    for name, kw, expect in [("upload 500", dict(upload=500), "The reader could not finish"), ("{} from call", dict(call={}), "cannot read"),
                             ("sse error null", dict(stream=sse("error", "null")), "stopped without saying why"), ("garbage sse", dict(stream="<html>oops</html>"), "cannot read"),
                             ("quota text", dict(stream=sse("error", json.dumps("You have exceeded your GPU quota"))), "free daily reading time is used up"),
                             ("upload 429", dict(upload=429), "free daily reading time is used up"), ("network abort", dict(abort="/gradio_api/upload"), "Could not reach the reader"),
                             ("abort on stream", dict(abort="/call/read/abc123"), "Could not reach the reader"), ("zero moves", dict(result=dict(FIX, moves=[])), "found no moves")]:
        ctx, pg, m = new(b, **kw); read(pg, wait=None); pg.wait_for_selector("#rdStatus.err", timeout=15000)
        check("error: " + name, expect in status(pg), status(pg)); check("button re-enabled: " + name, pg.is_enabled("#rdRead") and pg.locator("#rdStatus.busy").count() == 0)
        check("no result card: " + name, pg.locator("#rdResult").count() == 0); ctx.close()
    ctx, pg, m = new(b, stream=sse("error", "null")); read(pg, wait=None); pg.wait_for_selector("#rdStatus.err")
    check("null error not shown as quota", "free daily reading time" not in status(pg)); ctx.close()

    # 4. hostile output
    evil = '"><img src=x onerror="window.__pwned=1">'
    ctx, pg, m = new(b, result={"tournament": evil, "white": evil, "black": "<script>window.__pwned=1</script>", "raw_text": evil,
        "moves": [{"move": 1, "colour": "w", "written": "<img src=x onerror=window.__pwned=1>", "confidence": 0.5, "suggestions": [evil, "e4"]}, {"move": 1, "colour": "b", "written": "e5", "confidence": "x", "suggestions": None}, None, 7, {"move": {}, "colour": 5}]})
    read(pg); pg.wait_for_timeout(300)
    check("markup not executed", pg.evaluate("window.__pwned") is None and pg.locator("#app img[src='x']").count() == 0)
    check("markup shown as text", "<img" in pg.locator(".rd-chip").first.inner_text() and pg.input_value(".rd-fields input >> nth=1") == evil)
    pg.locator(".rd-chip").first.click(); check("hostile suggestion is text", pg.locator(".rd-sug button").first.inner_text().startswith('"><img')); check("no errors (hostile)", pg.errs == [], pg.errs); ctx.close()
    big = {"moves": [{"move": (i >> 1) + 1, "colour": "b" if i % 2 else "w", "written": "e4", "confidence": 0.5} for i in range(1300)]}
    ctx, pg, m = new(b, result=big); t0 = time.time(); read(pg); dt = time.time() - t0
    check("600 rows no freeze", pg.locator(".rd-chip").count() == 600 and dt < 8, (pg.locator(".rd-chip").count(), dt)); pg.locator(".rd-chip").nth(300).click(); check("600 rows still responsive", "Check move 151." in pg.inner_text("#rdCheck")); ctx.close()
    for name, res in [("null result", None), ("moves not array", {"moves": "x"}), ("string garbage", "hello"), ("number", 5)]:
        ctx, pg, m = new(b, result=res); read(pg, wait=None); pg.wait_for_selector("#rdStatus.err"); check("bad result: " + name, "cannot read" in status(pg) and pg.errs == [], (status(pg), pg.errs)); ctx.close()
    ctx, pg, m = new(b, stream=sse("complete", json.dumps([json.dumps(FIX)]))); read(pg); check("result as JSON string", "26 of 60" in pg.inner_text("#rdSummary")); ctx.close()

    # 5. triple tap -> one read
    ctx, pg, m = new(b, delay=0.6); pg.set_input_files("#rdFile", JPG)
    pg.evaluate("(()=>{const b=document.querySelector('#rdRead');b.click();b.click();b.click()})()"); pg.wait_for_selector("#rdResult", timeout=15000)
    check("triple tap one read", m.n == {"upload": 1, "call": 1, "get": 1}, m.n); ctx.close()
    # reload mid-read: button not stuck
    ctx, pg, m = new(b, delay=3); pg.set_input_files("#rdFile", JPG); pg.click("#rdRead"); pg.wait_for_timeout(300); check("disabled while reading", pg.is_disabled("#rdRead"))
    pg.reload(); pg.wait_for_selector("#rdRead"); check("reload mid-read: button usable", pg.is_enabled("#rdRead")); ctx.close()

    # 6. bad files -> refused, zero uploads
    for name, f in [("text renamed .jpg", TXT), ("empty file", EMPTY), ("pdf", PDF), ("svg", SVG)]:
        ctx, pg, m = new(b); read(pg, files=f, wait=None); pg.wait_for_selector("#rdStatus.err")
        check("refused: " + name, "isn't a photo the app can open" in status(pg) and m.n["upload"] == 0, (status(pg), m.n)); check("svg script not run", pg.evaluate("window.__pwned") is None); ctx.close()
    ctx, pg, m = new(b); read(pg, files=[JPG, TXT], wait=None); pg.wait_for_selector("#rdStatus.err"); check("one bad file among good: nothing uploaded", m.n["upload"] == 0); ctx.close()
    ctx, pg, m = new(b); read(pg, files=[JPG] * 5, wait=None); pg.wait_for_selector("#rdStatus.err"); check("5 photos refused", "You picked 5 photos. Choose up to 4" in status(pg) and m.n["upload"] == 0, status(pg)); ctx.close()

    # 7. access, manual entry, desktop + 360 px
    ctx, pg, m = new(b, role="demo") if False else (None, None, None)
    c2 = b.new_context(); c2.add_init_script("localStorage.setItem('targetchess.v2', JSON.stringify({liveToken:'t',liveUser:{role:'demo'}}))"); p2 = c2.new_page(); p2.goto(URL); p2.wait_for_selector(".rd-card")
    check("demo locked", p2.locator("#rdRead").count() == 0 and "For Chess Sathi students" in p2.inner_text("body")); c2.close()
    c3 = b.new_context(); p3 = c3.new_page(); p3.goto(URL); p3.wait_for_selector(".rd-card"); check("signed out asked to sign in", "Please sign in" in p3.inner_text("body")); c3.close()
    ctx, pg, m = new(b, w=360, h=640); pg.locator(".rd-link", has_text="type the moves").click(); pg.fill("#rdManual", "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6"); pg.locator("button", has_text="Check these moves").click(); pg.wait_for_selector("#rdResult")
    check("manual entry", "6 of 6 moves legal" in pg.inner_text("#rdSummary") and m.n["upload"] == 0); w = pg.evaluate("document.documentElement.scrollWidth"); check("fits 360", w <= 360, w); pg.screenshot(path="/tmp/rd_360_manual.png", full_page=True); ctx.close()
    ctx, pg, m = new(b, w=360, h=640); read(pg); pg.locator(".rd-chip.bad").click(); w = pg.evaluate("document.documentElement.scrollWidth"); check("fits 360 with sheet", w <= 360, w); pg.screenshot(path="/tmp/rd_360.png", full_page=True); ctx.close()
    ctx, pg, m = new(b, w=1366, h=860, mobile=False); read(pg); pg.locator(".rd-chip.bad").click(); pg.wait_for_timeout(300); pg.screenshot(path="/tmp/rd_desktop.png", full_page=True)
    pg.keyboard.press("ArrowLeft"); check("desktop ok", pg.errs == [] and pg.locator("#rdLine .on").count() == 1, pg.errs)
    csp = pg.evaluate("document.querySelector('meta[http-equiv=Content-Security-Policy]').content"); check("CSP strict", "script-src 'self'" in csp and "https://*.hf.space" in csp and "unsafe" not in csp, csp); ctx.close()
    b.close()
print(f"\n{OK} checks passed, {len(FAILS)} failed"); [print("  -", f) for f in FAILS]; sys.exit(1 if FAILS else 0)
