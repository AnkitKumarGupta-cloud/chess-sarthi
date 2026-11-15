// Score-sheet reader: the screen. All text from the model or the user is put on the page with
// textContent (never as HTML), so markup in a name or a move can never run.
import * as L from "./logic.js";
import { readSheet, preparePhoto, checkCount, PhotoError, draft, games } from "./api.js";
import { SheetViewer } from "./viewer.js";

/* ---------- tiny DOM helper ---------- */
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v; else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k in e && k !== "list") e[k] = v; else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
const $ = (s) => document.querySelector(s);
const root = $("#app");

/* ---------- state ---------- */
const st = {
  session: null, busy: false, status: null, picked: [], previewUrl: null, notice: "", inputError: "", full: false,
  resume: null, result: "*", an: { idx: 0, flip: false, engine: false, info: "" }, lastKey: null, manual: false,
};
const viewer = new SheetViewer();
viewer.onFull = () => openFull();
let photoUrls = [];
const setPhotos = (urls) => { photoUrls.forEach((u) => URL.revokeObjectURL(u)); photoUrls = urls; viewer.setPages(urls); };
const persist = () => { if (st.session) draft.save(st.session); };

/* ---------- who may use it: signed-in students and coaches, not the demo login ---------- */
function access() {
  try { const S = JSON.parse(localStorage.getItem("targetchess.v2")) || {}; if (!S.liveToken) return "out"; return S.liveUser && S.liveUser.role === "demo" ? "demo" : "ok"; } catch { return "out"; }
}

/* ---------- reading ---------- */
async function startRead(files, add) {
  if (st.busy) return;                                   // one read at a time: extra taps are ignored
  st.busy = true; st.notice = ""; st.status = { text: "Checking the photo…" }; render();
  try {
    files = [...files];
    if (!files.length) throw new PhotoError("Choose a photo of the score sheet first.");
    checkCount(files.length + (add && st.session ? st.session.pages : 0));
    const ready = []; for (const f of files) ready.push(await preparePhoto(f));      // every file is checked before anything is uploaded
    if (!add) { closeFull(); await draft.clear(); st.session = null; setPhotos([]); st.lastKey = null; }
    let done = 0;
    for (const p of ready) {
      const page = st.session ? st.session.pages + 1 : 1, many = ready.length > 1 ? ` (photo ${done + 1} of ${ready.length})` : "";
      const res = await readSheet(p.upload, { page, onStage: (t) => { st.status = { text: t + many }; renderStatus(); } });
      if (st.session) { const r = L.addPage(st.session, res); if (r.message) st.notice = r.message; } else st.session = L.newSession(res);
      await draft.putPhoto(page, p.view); await photoUrlsFix();
      persist(); done++;
    }
    st.status = null; st.picked = []; setPreview(null); st.an.idx = 1e9;
  } catch (e) {
    st.status = { text: e instanceof L.ReaderError || e instanceof PhotoError ? e.message : "Something went wrong while reading. Please try again.", error: true };
    if (!(e instanceof L.ReaderError) && !(e instanceof PhotoError)) console.error(e);
  } finally { st.busy = false; render(); }
}
// setPhotos revokes the old URLs, so rebuild them from the saved blobs whenever a page is added.
async function photoUrlsFix() {
  const n = st.session ? st.session.pages : 0, urls = [];
  for (let p = 1; p <= n; p++) { const b = await draft.photo(p); if (b) urls[p - 1] = URL.createObjectURL(b); }
  setPhotos(urls);
}
function setPreview(file) { if (st.previewUrl) URL.revokeObjectURL(st.previewUrl); st.previewUrl = file ? URL.createObjectURL(file) : null; }
function startManual(text) {
  const res = L.normaliseResult(L.movesFromText(text));
  if (!res || !res.moves.length) { st.status = { text: "Type some moves first, for example: 1. e4 e5 2. Nf3", error: true }; return render(); }
  closeFull(); draft.clear(); setPhotos([]); st.session = L.newSession(res); st.session.pages = 0; st.status = null; st.manual = false; st.an.idx = 1e9; persist(); render();
}

/* ---------- review actions ---------- */
function rememberSpot(m) {                                // the user zoomed in and moved the photo to this move: remember where it is
  if (viewer.zoom < 1.6 || !viewer.userMoved || !photoUrls[viewer.page - 1]) return;
  const s = st.session, c = viewer.centre();
  s.anchors = s.anchors.filter((a) => !(a.page === viewer.page && a.colour === m.colour && a.move === m.move));
  s.anchors.push({ page: viewer.page, colour: m.colour, move: m.move, x: c.x, y: c.y });
}
function act(kind, i, value) {
  const s = st.session, m = s.moves[i]; if (!m) return;
  if (kind === "use") { const t = String(value || "").trim(); if (!t) { st.inputError = "Type a move first."; return render(); } rememberSpot(m); L.setPlayed(s, i, t); }
  else if (kind === "accept") { rememberSpot(m); L.acceptAsWritten(s, i); }
  else if (kind === "undo") L.resetMove(s, i);
  st.inputError = ""; s.focus = null; st.an.idx = 1e9; persist();
  if (st.full && L.currentIndex(s) == null) return closeFull(true);
  render();
}
function startOver() {
  if (!confirm("Start over? This sheet, your fixes and the photos will be removed from this device.")) return;
  closeFull(); draft.clear(); setPhotos([]); st.session = null; st.status = null; st.notice = ""; st.lastKey = null; render();
}

/* ---------- full screen (the phone's Back button closes it) ---------- */
function openFull() { if (st.full || !st.session || L.currentIndex(st.session) == null) return; st.full = true; history.pushState({ csFull: true }, ""); render(); }
function closeFull(rerender) {
  if (!st.full) { if (rerender) render(); return; }
  if (history.state && history.state.csFull) history.back();          // popstate does the closing
  else { st.full = false; render(); }
}
window.addEventListener("popstate", () => { if (st.full) { st.full = false; render(); } });
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && st.full) return closeFull();
  if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "") || st.full) return;
  if (e.key === "ArrowLeft") stepBoard(-1); else if (e.key === "ArrowRight") stepBoard(1);
});
window.addEventListener("pagehide", () => { if (st.full && history.state && history.state.csFull) history.back(); });

/* ---------- boards ---------- */
function boardEl(fen, { flip = false, last = null, big = false } = {}) {
  const b = h("div", { class: "rd-board" + (big ? " big" : "") });
  let grid; try { grid = new globalThis.Chess(fen).board(); } catch { return b; }
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const rr = flip ? 7 - r : r, ff = flip ? 7 - f : f, p = grid[rr][ff], name = "abcdefgh"[ff] + (8 - rr);
    b.append(h("div", { class: "sq " + ((rr + ff) % 2 ? "dk" : "lt") + (last && (last.from === name || last.to === name) ? " hl" : "") }, p ? h("div", { class: `pc ${p.color} pk-${p.type}` }) : null));
  }
  return b;
}
function stepBoard(d) { const line = L.playedLine(st.session || { moves: [] }); st.an.idx = Math.max(0, Math.min(line.length - 1, Math.min(st.an.idx, line.length - 1) + d)); renderOutput(); }

/* ---------- engine (Stockfish in the browser, off until asked for) ---------- */
const eng = { w: null, fen: null, failed: false };
function engine(fen) {
  if (!st.an.engine || eng.failed) return;
  try {
    if (!eng.w) {
      eng.w = new Worker("/stockfish/stockfish-18-lite-single.js");
      eng.w.onerror = () => { eng.failed = true; st.an.info = "The engine could not start on this device."; renderOutput(); };
      eng.w.onmessage = (e) => {
        const t = String(e.data || ""), m = t.match(/^info .*?depth (\d+).*?score (cp|mate) (-?\d+).*? pv (\S+)/);
        if (!m || !eng.fen) return;
        const white = eng.fen.split(" ")[1] === "w", v = +m[3] * (white ? 1 : -1);
        let best = m[4]; try { const g = new globalThis.Chess(eng.fen), mv = g.move({ from: best.slice(0, 2), to: best.slice(2, 4), promotion: best[4] }); if (mv) best = mv.san; } catch {}
        st.an.info = (m[2] === "mate" ? (v > 0 ? "White" : "Black") + " mates in " + Math.abs(v) : (v > 0 ? "+" : "") + (v / 100).toFixed(1)) + " · best move " + best + " · depth " + m[1];
        const out = $("#rdEngine"); if (out) out.textContent = st.an.info;
      };
      eng.w.postMessage("uci");
    }
    if (eng.fen === fen) return;
    eng.fen = fen; st.an.info = "Thinking…"; eng.w.postMessage("stop"); eng.w.postMessage("position fen " + fen); eng.w.postMessage("go depth 14");
  } catch { eng.failed = true; st.an.info = "The engine could not start on this device."; }
}

/* ---------- rendering ---------- */
const mark = (m) => (m.check === "illegal" ? "✗" : m.check === "unchecked" ? "?" : L.reviewReason(m) ? "!" : "✓");
function chipText(m, suspect) {
  return L.label(m) + m.written + (m.played != null ? "→" + m.played + " ✎" : "") + " " + mark(m) + (suspect ? " ▲" : "");
}
function moveBox(i) {
  const s = st.session, m = s.moves[i], illegal = m.check === "illegal";
  const input = h("input", { id: "rdMove", class: "rd-in", type: "text", maxLength: 12, placeholder: "Type the move, e.g. Nf3", autocomplete: "off", autocapitalize: "off", "autocorrect": "off", "aria-label": "The move that was played",
    onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); act("use", i, input.value); } } });
  input.setAttribute("spellcheck", "false");
  const sus = L.suspects(s, i);
  return h("div", { class: "rd-box" },
    m.suggestions.length ? h("div", { class: "rd-sug" }, h("span", { class: "rd-m", text: "Did the player mean…" }), m.suggestions.map((x) => h("button", { class: "rd-btn ghost", type: "button", text: x, onclick: () => act("use", i, x) }))) : null,
    h("div", { class: "rd-row" }, input, h("button", { id: "rdUse", class: "rd-btn", type: "button", text: "Use", onclick: () => act("use", i, input.value) })),
    st.inputError ? h("p", { class: "rd-err", role: "alert", text: st.inputError }) : null,
    h("button", { id: "rdAccept", class: "rd-btn ghost wide", type: "button", text: illegal ? "Keep it exactly as written (the player wrote an illegal move)" : "It is correct as written", onclick: () => act("accept", i) }),
    sus.length ? h("p", { class: "rd-hint", text: `An earlier move already went to this square (${sus.map((j) => L.label(s.moves[j]) + L.moveText(s.moves[j])).join(", ")}). Either this move was misread, or that one was — check both against the photo.` }) : null);
}
function reviewHead(i) {
  const m = st.session.moves[i], why = L.reviewReason(m) || (m.check === "unchecked" ? "Not checkable yet" : "Looks fine");
  return { title: `Check move ${m.move}${m.colour === "b" ? "… (Black)" : "."}`, sub: `Read as ${m.written}${m.played != null ? ", changed to " + m.played : ""} · ${why}${m.confidence != null ? " · confidence " + Math.round(m.confidence * 100) + "%" : ""}` };
}

function renderStatus() { const e = $("#rdStatus"); if (!e) return; e.textContent = st.status ? st.status.text : ""; e.className = "rd-status" + (st.status && st.status.error ? " err" : st.busy ? " busy" : ""); }

function captureCard() {
  const s = st.session, pick = (add) => h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", multiple: true, class: "rd-file", id: add ? "rdAddFile" : "rdFile",
    onchange: (e) => { const f = [...e.target.files]; e.target.value = ""; if (!f.length) return; if (add) return startRead(f, true); st.picked = f; setPreview(f[0]); st.status = null; render(); } });
  const file = pick(false), addFile = pick(true), ta = h("textarea", { class: "rd-ta", id: "rdManual", rows: 4, placeholder: "1. e4 e5 2. Nf3 Nc6 …" });
  return h("section", { class: "rd-card" },
    h("h2", { text: s ? "Read another sheet" : "Read a score sheet" }),
    h("p", { class: "rd-m", text: "Take a sharp, straight-on photo of one page. Up to 4 photos (one per page). A read takes about 10–30 seconds." }),
    file, addFile,
    st.previewUrl ? h("div", { class: "rd-prev" }, h("img", { src: st.previewUrl, alt: "The photo you chose" }), h("span", { class: "rd-m", text: st.picked.length > 1 ? st.picked.length + " photos chosen" : "1 photo chosen" })) : null,
    h("div", { class: "rd-row wrap" },
      h("button", { class: "rd-btn ghost", type: "button", text: st.picked.length ? "Choose a different photo" : "Choose photo", disabled: st.busy, onclick: () => file.click() }),
      h("button", { id: "rdRead", class: "rd-btn big", type: "button", text: "📷 Read score sheet", disabled: st.busy, onclick: () => (st.picked.length ? startRead(st.picked, false) : file.click()) }),
      s && s.pages > 0 && s.pages < L.MAX_PHOTOS ? h("button", { id: "rdAdd", class: "rd-btn ghost", type: "button", text: "Add another page", disabled: st.busy, onclick: () => addFile.click() }) : null),
    h("p", { id: "rdStatus", class: "rd-status" + (st.status && st.status.error ? " err" : st.busy ? " busy" : ""), role: "status", text: st.status ? st.status.text : "" }),
    st.notice ? h("p", { class: "rd-m", text: st.notice }) : null,
    st.manual ? h("div", { class: "rd-stack" }, ta, h("button", { class: "rd-btn ghost", type: "button", text: "Check these moves", onclick: () => startManual(ta.value) }))
      : h("button", { class: "rd-link", type: "button", text: "Or type the moves in by hand", onclick: () => { st.manual = true; render(); } }));
}
function resumeCard() {
  const d = st.resume;
  return h("section", { class: "rd-card", id: "rdResume" }, h("h2", { text: "Continue your last sheet?" }),
    h("p", { class: "rd-m", text: `${d.moves.length} moves${d.white || d.black ? " · " + (d.white || "?") + " – " + (d.black || "?") : ""}. Your fixes were saved on this device.` }),
    h("div", { class: "rd-row wrap" },
      h("button", { class: "rd-btn", type: "button", text: "Continue", onclick: async () => { d.anchors = Array.isArray(d.anchors) ? d.anchors : []; d.focus = null; st.session = L.recheck(d); st.resume = null; st.an.idx = 1e9; await photoUrlsFix(); render(); } }),
      h("button", { class: "rd-btn ghost", type: "button", text: "Discard it", onclick: () => { st.resume = null; draft.clear(); render(); } })));
}
function resultCard() {
  const s = st.session, sum = L.summary(s), cur = L.currentIndex(s), sus = cur != null ? L.suspects(s, cur) : [];
  const field = (label, key, max) => h("label", { class: "rd-fld" }, h("span", { text: label }), h("input", { type: "text", value: s[key], maxLength: max, autocomplete: "off", oninput: (e) => { s[key] = e.target.value; persist(); const p = $("#rdPgn"); if (p) p.textContent = L.toPGN(s, { result: st.result }); } }));
  const parts = [sum.illegal ? `${sum.illegal} cannot be played` : "", sum.unchecked ? `${sum.unchecked} not checkable yet` : "", sum.unsure ? `${sum.unsure} unsure` : ""].filter(Boolean);
  const chips = h("div", { class: "rd-chips", id: "rdChips" }, s.moves.map((m, i) => h("button", { type: "button", "data-i": i,
    class: "rd-chip " + (m.check === "illegal" ? "bad" : m.check === "unchecked" ? "unk" : L.reviewReason(m) ? "low" : "ok") + (i === cur ? " cur" : "") + (sus.includes(i) ? " sus" : ""),
    text: chipText(m, sus.includes(i)), onclick: () => { s.focus = i; st.inputError = ""; persist(); render(); const r = $("#rdReview"); if (r && r.scrollIntoView) r.scrollIntoView({ block: "start", behavior: "smooth" }); } })));
  return h("section", { class: "rd-card", id: "rdResult" },
    h("h2", { text: `Score sheet read — ${sum.total} move${sum.total === 1 ? "" : "s"}${s.pages ? ` · ${s.pages} page${s.pages === 1 ? "" : "s"}` : ""}` }),
    h("div", { class: "rd-fields" }, field("Tournament", "tournament", 120), field("White", "white", 80), field("Black", "black", 80)),
    h("p", { class: "rd-m", text: "Names come from the reader and can be wrong — fix them here." }),
    h("p", { id: "rdSummary", class: "rd-sum" }, h("b", { text: `${sum.legal} of ${sum.total} moves legal` }), parts.length ? " · " + parts.join(" · ") : ""),
    chips,
    h("p", { class: "rd-m", text: "✓ legal · ! unsure · ✗ cannot be played · ? not checked yet · ✎ changed by you. Tap a move to check it." }));
}
function reviewCard() {
  const s = st.session, i = L.currentIndex(s), left = L.reviewList(s).length, dec = L.decisions(s);
  const kids = [];
  if (i == null) kids.push(h("h2", { text: "All moves checked" }), h("p", { class: "rd-m", text: L.summary(s).complete ? "Every move is legal. The game is on the board below." : "Nothing left to check. Tap any move above to look at it again." }));
  else {
    const m = s.moves[i], hd = reviewHead(i);
    kids.push(h("h2", { id: "rdCheck", text: hd.title }), h("p", { class: "rd-m", text: hd.sub }));
    if (!st.full) {
      kids.push(viewer.root,
        h("div", { class: "rd-pos" }, m.fenBefore ? boardEl(m.fenBefore, { flip: m.colour === "b" }) : h("p", { class: "rd-m rd-unknown", text: "Position unknown until the move before is fixed." }),
          m.fenBefore ? h("p", { class: "rd-m", text: `The position before this move. ${m.colour === "w" ? "White" : "Black"} to play.` }) : null),
        moveBox(i));
    } else kids.push(h("p", { class: "rd-m", text: "Open in full screen…" }));
    kids.push(h("p", { class: "rd-m", id: "rdLeft", text: `${left} left to check` }));
  }
  if (dec.length) kids.push(h("details", { class: "rd-dec" }, h("summary", { text: `Your decisions (${dec.length})` }),
    h("ul", null, dec.map((j) => { const m = s.moves[j]; return h("li", null, h("span", { text: `${L.label(m)}${m.written}${m.played != null ? " → " + m.played : m.accepted ? " kept as written" : " correct"}` }), h("button", { class: "rd-link", type: "button", text: "Undo", onclick: () => act("undo", j) })); }))));
  kids.push(h("button", { class: "rd-link danger", id: "rdStartOver", type: "button", text: "Start over", onclick: startOver }));
  return h("section", { class: "rd-card", id: "rdReview" }, kids);
}
function outputCard() {
  const s = st.session, line = L.playedLine(s), sum = L.summary(s);
  st.an.idx = Math.max(0, Math.min(st.an.idx, line.length - 1));
  const at = line[st.an.idx], pgn = L.toPGN(s, { result: st.result });
  engine(at.fen);
  const nav = (t, label, d) => h("button", { class: "rd-btn ghost sq", type: "button", text: t, "aria-label": label, onclick: () => { st.an.idx = d === "s" ? 0 : d === "e" ? line.length - 1 : st.an.idx + d; stepBoard(0); } });
  const list = h("ol", { class: "rd-line", id: "rdLine" }, line.slice(1).map((p, k) => h("li", { class: k + 1 === st.an.idx ? "on" : "" }, h("button", { type: "button", text: (p.colour === "w" ? p.move + ". " : "") + p.san, onclick: () => { st.an.idx = k + 1; renderOutput(); } }))));
  return h("section", { class: "rd-card", id: "rdOutput" },
    h("h2", { text: "Analysis board" }),
    h("p", { class: "rd-m", text: sum.playable < sum.total ? `The legal part is on the board: ${line.length - 1} of ${sum.total} moves. Fix the move marked ✗ to see the rest.` : "The whole game is on the board." }),
    h("div", { class: "rd-an" },
      h("div", { class: "rd-an-b" }, boardEl(at.fen, { flip: st.an.flip, last: at.from ? at : null, big: true }),
        h("div", { class: "rd-row" }, nav("⏮", "First move", "s"), nav("◀", "Back one move", -1), nav("▶", "Forward one move", 1), nav("⏭", "Last move", "e"),
          h("button", { class: "rd-btn ghost", type: "button", text: "Flip", onclick: () => { st.an.flip = !st.an.flip; renderOutput(); } }))),
      h("div", { class: "rd-an-s" },
        h("button", { id: "rdAnalyse", class: "rd-btn" + (st.an.engine ? " ghost" : ""), type: "button", text: st.an.engine ? "Turn the engine off" : "Analyse on the board", onclick: () => { st.an.engine = !st.an.engine; if (!st.an.engine && eng.w) { eng.w.postMessage("stop"); eng.fen = null; st.an.info = ""; } renderOutput(); } }),
        st.an.engine ? h("p", { class: "rd-eng", id: "rdEngine", text: st.an.info || "Thinking…" }) : h("p", { class: "rd-m", text: "The engine shows who is better and the best move in each position." }),
        list.children.length ? list : h("p", { class: "rd-m", text: "No legal moves yet." }))),
    h("div", { class: "rd-row wrap" },
      h("label", { class: "rd-fld inline" }, h("span", { text: "Result" }), h("select", { id: "rdResultSel", onchange: (e) => { st.result = e.target.value; renderOutput(); } }, [["*", "Not finished / unknown"], ["1-0", "White won"], ["0-1", "Black won"], ["1/2-1/2", "Draw"]].map(([v, t]) => h("option", { value: v, text: t, selected: st.result === v })))),
      h("button", { id: "rdCopy", class: "rd-btn ghost", type: "button", text: "Copy PGN", onclick: async (e) => { try { await navigator.clipboard.writeText(pgn); e.target.textContent = "Copied"; } catch { e.target.textContent = "Select the text below to copy"; } } }),
      h("button", { id: "rdDownload", class: "rd-btn ghost", type: "button", text: "Download PGN", onclick: () => { const a = h("a", { href: URL.createObjectURL(new Blob([pgn], { type: "application/x-chess-pgn" })), download: L.pgnFileName(s) }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); } }),
      h("button", { id: "rdSave", class: "rd-btn ghost", type: "button", text: "Save to my games", onclick: (e) => { games.add({ id: Date.now().toString(36), title: `${s.white || "?"} – ${s.black || "?"}`, event: s.tournament, date: L.localDate(), moves: line.length - 1, pgn }); e.target.textContent = "Saved"; renderGames(); } })),
    h("pre", { class: "rd-pgn", id: "rdPgn", text: pgn }),
    s.rawText ? h("details", { class: "rd-dec" }, h("summary", { text: "What the reader saw (raw text)" }), h("pre", { class: "rd-pgn", text: s.rawText })) : null);
}
function gamesCard() {
  const all = games.list(); if (!all.length) return null;
  return h("section", { class: "rd-card", id: "rdGames" }, h("h2", { text: `My games (${all.length})` }), h("p", { class: "rd-m", text: "Saved on this device only." }),
    h("ul", { class: "rd-games" }, all.map((g) => h("li", null,
      h("div", null, h("b", { text: String(g.title || "Game").slice(0, 120) }), h("span", { class: "rd-m", text: ` ${String(g.date || "")} · ${+g.moves || 0} moves` })),
      h("div", { class: "rd-row" },
        h("button", { class: "rd-link", type: "button", text: "Open", onclick: () => openGame(g) }),
        h("button", { class: "rd-link", type: "button", text: "Copy PGN", onclick: async (e) => { try { await navigator.clipboard.writeText(String(g.pgn || "")); e.target.textContent = "Copied"; } catch {} } }),
        h("button", { class: "rd-link danger", type: "button", text: "Delete", onclick: () => { if (confirm("Delete this saved game?")) { games.remove(g.id); renderGames(); } } }))))));
}
function openGame(g) {
  if (st.session && !confirm("Open this saved game? The sheet you are working on will be replaced.")) return;
  const c = new globalThis.Chess(); if (!c.load_pgn(String(g.pgn || "").replace(/\{[^}]*\}/g, ""), { sloppy: true })) return alert("This saved game could not be opened.");
  const head = c.header(), res = L.normaliseResult({ tournament: head.Event === "?" ? "" : head.Event, white: head.White === "?" ? "" : head.White, black: head.Black === "?" ? "" : head.Black, moves: c.history().map((w, i) => ({ move: (i >> 1) + 1, colour: i % 2 ? "b" : "w", written: w, confidence: 1 })) });
  if (!res || !res.moves.length) return alert("This saved game has no moves.");
  closeFull(); draft.clear(); setPhotos([]); st.session = L.newSession(res); st.session.pages = 0; st.an.idx = 0; persist(); render(); const o = $("#rdOutput"); if (o) o.scrollIntoView({ block: "start" });
}

function fullOverlay() {
  const s = st.session, i = L.currentIndex(s); if (i == null) return null;
  const hd = reviewHead(i);
  return h("div", { class: "rd-full", id: "rdFull", role: "dialog", "aria-label": "Score sheet, full screen" },
    h("div", { class: "rd-full-h" }, h("div", null, h("b", { text: hd.title }), h("span", { class: "rd-m", text: " " + hd.sub })), h("button", { class: "rd-btn ghost sq", id: "rdFullClose", type: "button", text: "✕", "aria-label": "Close full screen", onclick: () => closeFull() })),
    viewer.root, moveBox(i));
}
function follow() {                                        // move the photo to the current move when we can guess where it is
  const s = st.session; if (!s) return;
  const i = L.currentIndex(s), m = i == null ? null : s.moves[i], key = m ? m.move + m.colour : null;
  if (key === st.lastKey) return; st.lastKey = key; if (!m) return;
  const guess = L.predictView(s.anchors, { page: m.page, colour: m.colour, move: m.move });
  if (guess) viewer.goTo(m.page, guess.x, guess.y); else if (m.page !== viewer.page && photoUrls[m.page - 1]) viewer.setPage(m.page);
}
function renderOutput() { const old = $("#rdOutput"); if (old && st.session) old.replaceWith(outputCard()); const on = $("#rdLine .on"), lb = $("#rdLine"); if (on && lb) lb.scrollTop = on.offsetTop - lb.clientHeight / 2; }
function renderGames() { const old = $("#rdGames"), n = gamesCard(); if (old && n) old.replaceWith(n); else if (old) old.remove(); else if (n) root.append(n); }
function render() {
  const who = access(), typed = $("#rdMove") ? $("#rdMove").value : "", hadFocus = document.activeElement && document.activeElement.id === "rdMove";
  const head = h("header", { class: "rd-top" }, h("a", { class: "rd-back", href: "/", text: "← Chess Sathi" }), h("h1", { text: "Score-sheet reader" }));
  document.body.classList.toggle("fs-open", st.full);
  if (who !== "ok") {
    return root.replaceChildren(head, h("section", { class: "rd-card" }, h("h2", { text: who === "demo" ? "For Chess Sathi students" : "Please sign in" }),
      h("p", { class: "rd-m", text: who === "demo" ? "The score-sheet reader opens when you join Chess Sathi. Ask your coach after class." : "Sign in to Chess Sathi first, then come back to this page." }),
      h("a", { class: "rd-btn", href: "/", text: who === "demo" ? "Back to Chess Sathi" : "Go to sign in" })));
  }
  const s = st.session;
  root.replaceChildren(...[head, st.resume && !s ? resumeCard() : null, s ? resultCard() : null, s ? reviewCard() : null, captureCard(), s ? outputCard() : null, gamesCard(), st.full && s ? fullOverlay() : null].filter(Boolean));
  viewer.fullBtn.hidden = st.full;
  if (s) {
    follow(); viewer.apply();
    const cur = $("#rdChips .cur"), box = $("#rdChips");
    if (cur && box && (cur.offsetTop < box.scrollTop || cur.offsetTop + cur.offsetHeight > box.scrollTop + box.clientHeight)) box.scrollTop = cur.offsetTop - box.clientHeight / 2;
    const on = $("#rdLine .on"), lb = $("#rdLine"); if (on && lb) lb.scrollTop = on.offsetTop - lb.clientHeight / 2;
    const inp = $("#rdMove"); if (inp && st.inputError) { inp.value = typed; } if (inp && hadFocus) inp.focus();
  }
}

/* ---------- start ---------- */
st.resume = draft.load();
render();
