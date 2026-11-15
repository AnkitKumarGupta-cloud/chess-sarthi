// Score-sheet reader: pure logic (no screen code). Unit-tested in test/reader.test.mjs.
// Needs chess.js as globalThis.Chess (the page loads /vendor/chess-0.10.3.min.js; tests set it).
//
// Rules that must not change without asking the owner:
//  1. `written` is what the model read and is never modified. The human's choice goes in `played`.
//  2. Legality checking only flags. The single automatic fix is fixCase() (capital/small letter slips),
//     used for checking/display.
//  3. After the first move that cannot be played, later moves are "unchecked" until it is fixed.
//  4. Everything from the model is untrusted text.

const newGame = (fen) => (fen ? new globalThis.Chess(fen) : new globalThis.Chess());
export const LOW_CONF = 0.7;       // below this a move joins the "left to check" queue
export const NOTE_CONF = 0.9;      // below this it only gets a ! on its chip
// Why 0.70: on 5 hand-labelled test sheets (601 moves) the 0.90 line flagged 74 moves of which 46 were
// correct; 0.70 flags 39 (16 correct) and misses 5 more misreads, most of which are illegal moves anyway.
export const MAX_MOVES = 600;      // plies kept from one read
export const MAX_PHOTOS = 4;

/* ---------- 4.2 fixCase: the only automatic correction ---------- */
export function fixCase(s) {
  return String(s == null ? "" : s).trim()
    .replace(/^[o0]-[o0]-[o0]/i, "O-O-O").replace(/^[o0]-[o0]/i, "O-O")
    .replace(/X/g, "x")                                                                         // KXF4 -> KxF4
    .replace(/[A-H](?=[1-8])(?![1-8]x?[a-h][1-8])/g, (c) => c.toLowerCase())                    // a capital before a rank is a square: F3 -> f3, KF4 -> Kf4 (not B1d3)
    .replace(/^[ACDEFGH](?=x)/, (c) => c.toLowerCase())                                         // Exd5 -> exd5 (B is left alone: Bxc3 is a bishop)
    .replace(/^[nkqr](?=[a-h1-8x:×])/, (c) => c.toUpperCase())                                  // n,k,q,r are never files; b is (b4, bxc3)
    .replace(/([a-h][18])(=?)([nqrb])/, (_, sq, eq, p) => sq + eq + p.toUpperCase());           // promotion piece
}

/* ---------- 4.1 moveKey: comparable form ---------- */
export function moveKey(s) {
  return fixCase(s).replace(/e\.p\.?/gi, "").replace(/[+#!?‼⁇⁈⁉\sx×:=]/g, "");
}

export const ply = (m) => (m.move - 1) * 2 + (m.colour === "b" ? 1 : 0);
export const moveText = (m) => (m.played != null ? m.played : m.written);
export const label = (m) => m.move + (m.colour === "b" ? "…" : ".");

/* ---------- reading the model's answer defensively ---------- */
const text = (v, max) => (typeof v === "string" ? v : v == null ? "" : typeof v === "number" ? String(v) : "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").slice(0, max);
export function normaliseResult(raw, page = 1) {
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { raw = null; } }
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.moves)) return null;
  const seen = new Map();
  for (const r of raw.moves) {
    if (seen.size >= MAX_MOVES) break;
    if (!r || typeof r !== "object") continue;
    const n = Number(r.move), colour = r.colour === "w" || r.colour === "b" ? r.colour : null, written = text(r.written, 16).trim();
    if (!Number.isInteger(n) || n < 1 || n > 400 || !colour || !written) continue;
    const c = typeof r.confidence === "number" && r.confidence >= 0 && r.confidence <= 1 ? r.confidence : null;
    const m = { move: n, colour, written, confidence: c, page,
      suggestions: (Array.isArray(r.suggestions) ? r.suggestions : []).map((x) => text(x, 12).trim()).filter(Boolean).slice(0, 3),
      played: null, confirmed: false, accepted: false, check: "unchecked", san: null, fenBefore: null };
    const k = ply(m), old = seen.get(k);
    if (!old || (c ?? -1) > (old.confidence ?? -1)) seen.set(k, m);       // same move twice in one read: keep the clearer one
  }
  return { tournament: text(raw.tournament, 120).trim(), white: text(raw.white, 80).trim(), black: text(raw.black, 80).trim(),
    rawText: text(raw.raw_text, 20000), moves: [...seen.values()].sort((a, b) => ply(a) - ply(b)) };
}
export function newSession(res) {
  const s = { tournament: res.tournament, white: res.white, black: res.black, rawText: res.rawText, pages: 1, moves: res.moves, anchors: [], focus: null };
  recheck(s); return s;
}

/* ---------- 4.3 recheck: replay from the start ---------- */
export function recheck(session) {
  session.moves.sort((a, b) => ply(a) - ply(b));
  const g = newGame(); let broken = false, expected = 0;
  for (const m of session.moves) {
    if (!broken && ply(m) !== expected) broken = true;                 // a move is missing (e.g. page 2 not scanned)
    m.fenBefore = broken ? null : g.fen();
    if (broken) { m.check = "unchecked"; m.san = null; expected = ply(m) + 1; continue; }
    const key = moveKey(moveText(m)), found = key ? g.moves().find((san) => moveKey(san) === key) : null;
    if (found) { m.check = "ok"; m.san = found; g.move(found); } else { m.check = "illegal"; m.san = null; broken = true; }
    expected++;
  }
  return session;
}

/* ---------- 4.4 review rules ---------- */
export function reviewReason(m) {
  if (m.accepted) return null;
  if (m.check === "illegal") return m.confirmed ? "Still not a legal move here" : "Cannot be played in this position";
  if (m.confirmed) return null;
  if (m.confidence != null && m.confidence < LOW_CONF) return "Low confidence";
  return null;
}
export const reviewList = (s) => s.moves.map((m, i) => (reviewReason(m) ? i : -1)).filter((i) => i >= 0);
export function currentIndex(s) {
  if (s.focus != null && s.moves[s.focus]) return s.focus;
  const l = reviewList(s); return l.length ? l[0] : null;
}
export function setPlayed(s, i, value) {
  const m = s.moves[i]; if (!m) return;
  const t = String(value == null ? "" : value).trim().slice(0, 12);
  m.played = t === m.written ? null : t; m.confirmed = true; m.accepted = false; recheck(s);
}
export function acceptAsWritten(s, i) { const m = s.moves[i]; if (!m) return; m.played = null; m.confirmed = true; m.accepted = true; recheck(s); }
export function resetMove(s, i) { const m = s.moves[i]; if (!m) return; m.played = null; m.confirmed = false; m.accepted = false; recheck(s); }
const dest = (m) => { const k = moveKey(moveText(m)).match(/[a-h][1-8]/g); return k ? k[k.length - 1] : null; };
// Earlier moves by the same side that already went to this illegal move's square: one of the two was probably misread.
export function suspects(s, i) {
  const m = s.moves[i]; if (!m || m.check !== "illegal") return [];
  const d = dest(m); if (!d) return [];
  const out = []; for (let j = 0; j < i; j++) if (s.moves[j].colour === m.colour && dest(s.moves[j]) === d) out.push(j);
  return out;
}
export function summary(s) {
  const total = s.moves.length, count = (f) => s.moves.filter(f).length;
  let playable = s.moves.findIndex((m) => m.check !== "ok"); if (playable < 0) playable = total;
  const pending = reviewList(s).length, legal = count((m) => m.check === "ok");
  return { total, pending, playable, legal, illegal: count((m) => m.check === "illegal"), unchecked: count((m) => m.check === "unchecked"),
    unsure: count(isUnsure), complete: pending === 0 && legal === total && total > 0 };
}
// A legal-looking move the reader was not fully sure of: it gets a ! on its chip.
export const isUnsure = (m) => !m.confirmed && !m.accepted && m.check !== "illegal" && m.confidence != null && m.confidence < NOTE_CONF;
export const decisions = (s) => s.moves.map((m, i) => (m.confirmed ? i : -1)).filter((i) => i >= 0);

/* ---------- 4.5 several pages ---------- */
export function addPage(s, res) {
  const page = s.pages + 1; let dupes = 0;
  for (const n of res.moves) {
    n.page = page;
    const i = s.moves.findIndex((m) => ply(m) === ply(n));
    if (i < 0) { s.moves.push(n); continue; }
    dupes++;
    const old = s.moves[i];
    if (!old.confirmed && (n.confidence ?? -1) > (old.confidence ?? -1)) s.moves[i] = n;
  }
  if (!s.tournament) s.tournament = res.tournament;
  if (!s.white) s.white = res.white;
  if (!s.black) s.black = res.black;
  s.rawText = (s.rawText ? s.rawText + "\n\n" : "") + res.rawText;
  s.pages = page; s.focus = null; recheck(s);
  return { dupes, message: dupes ? `${dupes} move${dupes === 1 ? "" : "s"} appeared on two pages — kept the clearer read.` : "" };
}

/* ---------- 4.6 PGN ---------- */
const header = (v) => String(v == null ? "" : v).replace(/[\r\n\t]+/g, " ").replace(/"/g, "'").replace(/\\/g, "").trim().slice(0, 200) || "?";
export const localDate = (d = new Date()) => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
export function toPGN(s, { result = "*", date } = {}) {
  const res = ["1-0", "0-1", "1/2-1/2", "*"].includes(result) ? result : "*";
  const tags = [["Event", s.tournament], ["Date", date || localDate()], ["White", s.white], ["Black", s.black], ["Result", res]];
  const stop = s.moves.find((m) => m.check !== "ok");
  if (stop) tags.push(["Annotator", stop.check === "illegal"
    ? `Score sheet reader: move ${stop.move}${stop.colour === "b" ? "..." : "."} '${moveText(stop)}' cannot be played`
    : `Score sheet reader: moves from ${stop.move}${stop.colour === "b" ? "..." : "."} could not be checked`]);
  const body = [];
  for (const m of s.moves) {
    if (m.check !== "ok") break;
    body.push((m.colour === "w" ? m.move + ". " : "") + m.san + (m.played != null ? ` {written: ${m.written.replace(/[{}]/g, "")}}` : ""));
  }
  body.push(res);
  return tags.map(([k, v]) => `[${k} "${header(v)}"]`).join("\n") + "\n\n" + wrap(body) + "\n";
}
// Wraps at about 80 characters without splitting a move from its {written: …} note.
function wrap(units, w = 80) { const out = []; let line = ""; for (const u of units) { if (line && (line + " " + u).length > w) { out.push(line); line = u; } else line = line ? line + " " + u : u; } if (line) out.push(line); return out.join("\n"); }
export const pgnFileName = (s) => ([s.white, s.black].map((x) => String(x || "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30)).filter(Boolean).join("_vs_") || "score-sheet") + ".pgn";
// Positions of the legal part, for the board: [{ fen, san, from, to }]
export function playedLine(s) {
  const g = newGame(), out = [{ fen: g.fen(), san: null }];
  for (const m of s.moves) { if (m.check !== "ok") break; const mv = g.move(m.san); if (!mv) break; out.push({ fen: g.fen(), san: m.san, from: mv.from, to: mv.to, move: m.move, colour: m.colour }); }
  return out;
}

/* ---------- 4.7 where a move is on the photo ---------- */
export function predictView(anchors, target) {
  const A = (anchors || []).filter((a) => a.page === target.page);
  if (!A.length) return null;
  const exact = A.find((a) => a.colour === target.colour && a.move === target.move);
  if (exact) return { x: exact.x, y: exact.y };
  const same = A.filter((a) => a.colour === target.colour);
  const below = same.filter((a) => a.move < target.move).sort((a, b) => b.move - a.move)[0];
  const above = same.filter((a) => a.move > target.move).sort((a, b) => a.move - b.move)[0];
  if (below && above && above.y > below.y && above.move - below.move <= 20) {
    const t = (target.move - below.move) / (above.move - below.move);
    return { x: below.x + (above.x - below.x) * t, y: below.y + (above.y - below.y) * t };
  }
  let pitch = null, gap = Infinity;                                      // row height from the closest pair going down the page
  for (const a of A) for (const b of A) {
    const d = b.move - a.move;
    if (d > 0 && d <= 20 && b.y > a.y && d < gap) { gap = d; pitch = (b.y - a.y) / d; }
  }
  const near = A.slice().sort((a, b) => Math.abs(a.move - target.move) - Math.abs(b.move - target.move) || (a.colour === target.colour ? 0 : 1) - (b.colour === target.colour ? 0 : 1))[0];
  const d = target.move - near.move;
  if (Math.abs(d) > 20) return null;
  if (d !== 0 && pitch == null) return null;
  const y = near.y + (pitch || 0) * d;
  if (!(y >= 0 && y <= 1)) return null;
  return { x: near.colour === target.colour ? near.x : null, y };
}

/* ---------- the reader's answers and errors ---------- */
export const QUOTA_RE = /quota|zerogpu|gpu (limit|time)|too many requests|rate.?limit|exceeded your/i;
export const MESSAGES = {
  quota: "The free daily reading time is used up. Try again tomorrow — or type the moves in manually.",
  timeout: "The reader took too long (over 2 minutes). Try again — the first read after a quiet period is the slowest.",
  network: "Could not reach the reader. Check your internet connection and try again.",
  empty: "The reader found no moves on this photo. Try a sharper, straight-on picture of one page.",
  bad: "The reader sent an answer the app cannot read.",
};
const NO_REASON = "it stopped without saying why — usually the free daily limit for your connection is used up, or the reader is having trouble";
export class ReaderError extends Error {
  constructor(code, reason) {
    super(code === "server" ? `The reader could not finish: ${String(reason || NO_REASON).replace(/\s+/g, " ").slice(0, 160)}. Try again later, or enter the moves manually.` : MESSAGES[code] || MESSAGES.bad);
    this.code = code;
  }
}
// Turns any failure text / HTTP status into one error.
export function classify(textOrNull, status) {
  const t = typeof textOrNull === "string" ? textOrNull : "";
  if (status === 429 || QUOTA_RE.test(t)) return new ReaderError("quota");
  return new ReaderError("server", t || (status ? `the reader answered with error ${status}` : ""));
}
export function parseSSE(body) {
  const out = [];
  for (const block of String(body || "").replace(/\r\n?/g, "\n").split(/\n\n+/)) {
    let event = "message"; const data = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (data.length || event !== "message") out.push({ event, data: data.join("\n") });
  }
  return out;
}
// From the SSE text of call ③ to a clean result, or a ReaderError.
export function resultFromSSE(body, page = 1) {
  const ev = parseSSE(body), err = ev.find((e) => e.event === "error"), done = ev.filter((e) => e.event === "complete").pop();
  if (!done) {
    if (err) { let d = null; try { d = JSON.parse(err.data); } catch { d = err.data; } throw classify(typeof d === "string" ? d : d && typeof d === "object" ? String(d.error || d.message || d.detail || "") : null); }
    throw new ReaderError("bad");
  }
  let data; try { data = JSON.parse(done.data); } catch { throw new ReaderError("bad"); }
  const res = normaliseResult(Array.isArray(data) ? data[0] : data, page);
  if (!res) throw new ReaderError("bad");
  if (!res.moves.length) throw new ReaderError("empty");
  return res;
}
// "1. d4 Nf6 2. c4 e6" typed by hand -> the same shape the reader gives (for manual entry)
export function movesFromText(t) {
  const tokens = String(t || "").replace(/\{[^}]*\}|\([^)]*\)|\[[^\]]*\]/g, " ").replace(/\d+\s*\.(\.\.)?/g, " ").split(/\s+/).filter((x) => x && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(x)).slice(0, MAX_MOVES);
  return { tournament: "", white: "", black: "", raw_text: String(t || "").slice(0, 20000), moves: tokens.map((w, i) => ({ move: (i >> 1) + 1, colour: i % 2 ? "b" : "w", written: w.slice(0, 16), confidence: 1, suggestions: [] })) };
}
