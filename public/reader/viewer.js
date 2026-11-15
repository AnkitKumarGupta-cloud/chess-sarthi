// Score-sheet viewer: a fixed window onto the photo. Drag to pan, pinch to zoom, double-tap 1x <-> 2.5x,
// ctrl + wheel on desktop, and - / + / Fit buttons. One instance is kept for the whole session so the
// view survives re-renders and moving between the page and full screen.
const MIN = 1, MAX = 6;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export class SheetViewer {
  constructor() {
    this.pages = [];                 // object URLs, index = page - 1
    this.page = 1; this.zoom = 1; this.cx = 0.5; this.cy = 0.5;
    this.userMoved = false;          // the user panned/zoomed since the last automatic jump
    this.root = el("div", "sv");
    this.win = el("div", "sv-win"); this.img = el("img", "sv-img"); this.img.alt = "Score sheet photo"; this.img.draggable = false;
    this.empty = el("p", "sv-empty", "The photo is not saved on this device any more. You can still fix moves by typing.");
    this.win.append(this.img, this.empty);
    this.bar = el("div", "sv-bar"); this.tabs = el("div", "sv-tabs");
    const btn = (t, label, fn) => { const b = el("button", "sv-b", t); b.type = "button"; b.setAttribute("aria-label", label); b.addEventListener("click", fn); return b; };
    this.fullBtn = btn("⤢ Full screen", "Full screen", () => this.onFull && this.onFull());
    this.bar.append(this.tabs, btn("−", "Zoom out", () => this.zoomBy(1 / 1.5, true)), btn("+", "Zoom in", () => this.zoomBy(1.5, true)), btn("Fit", "Fit the whole photo", () => { this.zoom = 1; this.cx = this.cy = 0.5; this.userMoved = true; this.apply(); }), this.fullBtn);
    this.root.append(this.win, this.bar);
    this.img.addEventListener("load", () => this.apply());
    this.gestures();
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => this.apply()).observe(this.win);
    window.addEventListener("resize", () => this.apply());
  }
  setPages(urls) { this.pages = urls; if (this.page > urls.length) this.page = 1; this.renderTabs(); this.show(); }
  renderTabs() {
    this.tabs.textContent = "";
    if (this.pages.length < 2) return;
    this.pages.forEach((_, i) => { const b = el("button", "sv-tab" + (i + 1 === this.page ? " on" : ""), "Page " + (i + 1)); b.type = "button"; b.addEventListener("click", () => { this.userMoved = true; this.setPage(i + 1); }); this.tabs.append(b); });
  }
  setPage(p) { if (p === this.page || p < 1 || p > Math.max(1, this.pages.length)) return; this.page = p; this.zoom = 1; this.cx = this.cy = 0.5; this.renderTabs(); this.show(); }
  show() { const u = this.pages[this.page - 1]; this.empty.hidden = !!u; this.img.hidden = !u; if (u && this.img.getAttribute("src") !== u) this.img.src = u; else this.apply(); }
  // Jump to a point of the photo (x may be null = keep the current x). Used to follow the current move.
  goTo(page, x, y) { this.setPage(page); if (x != null) this.cx = x; this.cy = y; if (this.zoom < 2) this.zoom = 2.5; this.userMoved = false; this.apply(); }
  centre() { return { x: this.cx, y: this.cy }; }
  zoomBy(f, user) { this.zoom = Math.min(MAX, Math.max(MIN, this.zoom * f)); if (user) this.userMoved = true; this.apply(); }
  apply() {
    const W = this.win.clientWidth, H = this.win.clientHeight, iw = this.img.naturalWidth, ih = this.img.naturalHeight;
    if (!W || !H || !iw || !ih) return;
    const s = Math.min(W / iw, H / ih) * this.zoom, w = iw * s, h = ih * s;
    let left = W / 2 - this.cx * w, top = H / 2 - this.cy * h;
    left = w <= W ? (W - w) / 2 : Math.min(0, Math.max(W - w, left));          // the photo can't be dragged away
    top = h <= H ? (H - h) / 2 : Math.min(0, Math.max(H - h, top));
    this.cx = (W / 2 - left) / w; this.cy = (H / 2 - top) / h; this.scale = s;
    const st = this.img.style; st.width = w + "px"; st.height = h + "px"; st.left = left + "px"; st.top = top + "px";
  }
  gestures() {
    const pts = new Map(); let last = null, pinch = 0, lastTap = 0, moved = 0;
    const w = this.win;
    w.addEventListener("pointerdown", (e) => { if (e.button > 0) return; try { w.setPointerCapture(e.pointerId); } catch {} pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); last = { x: e.clientX, y: e.clientY }; moved = 0; pinch = pts.size === 2 ? dist() : 0; });
    const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    w.addEventListener("pointermove", (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) { const d = dist(); if (pinch > 0 && d > 0) { this.zoom = Math.min(MAX, Math.max(MIN, this.zoom * d / pinch)); this.userMoved = true; this.apply(); } pinch = d; return; }
      if (!last || !this.scale) return;
      const dx = e.clientX - last.x, dy = e.clientY - last.y; last = { x: e.clientX, y: e.clientY }; moved += Math.abs(dx) + Math.abs(dy);
      const iw = this.img.naturalWidth * this.scale, ih = this.img.naturalHeight * this.scale; if (!iw || !ih) return;
      this.cx -= dx / iw; this.cy -= dy / ih; if (moved > 6) this.userMoved = true; this.apply();
    });
    const up = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId); pinch = 0; last = pts.size ? [...pts.values()][0] : null;
      if (pts.size === 0 && moved < 8 && e.type === "pointerup") {             // a tap: two quick ones toggle the zoom
        const now = Date.now();
        if (now - lastTap < 320) { lastTap = 0; this.toggleAt(e.clientX, e.clientY); } else lastTap = now;
      }
    };
    w.addEventListener("pointerup", up); w.addEventListener("pointercancel", up);
    w.addEventListener("wheel", (e) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); this.zoomBy(Math.exp(-e.deltaY / 200), true); }, { passive: false });
  }
  toggleAt(clientX, clientY) {
    if (this.zoom > 1.01) { this.zoom = 1; this.cx = this.cy = 0.5; }
    else {
      const r = this.img.getBoundingClientRect();
      if (r.width && r.height) { this.cx = Math.min(1, Math.max(0, (clientX - r.left) / r.width)); this.cy = Math.min(1, Math.max(0, (clientY - r.top) / r.height)); }
      this.zoom = 2.5;
    }
    this.userMoved = true; this.apply();
  }
}
