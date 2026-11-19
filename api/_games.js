import { handler, HttpError, kv, kvPipe, whoIs } from "./_lib.js";
import { whose } from "./_attempts.js";
import { addAttempts, parseRecord } from "./_weak.js";

// Game doctor: the games a child had checked (Stockfish runs in the child's browser; the server only keeps the result).
//  GET    (student / their parent / teacher with ?student=)  -> { games: [ ... ] }   newest first
//  POST   (student)  { game, resetAck, d }   -> saves one finished analysis. The same game (same id) is saved once, never twice.
//         Each mistake that got a tag also counts as one missed attempt of that theme in the weakness tracker (at:<student>).
//  DELETE (parent of the child, or teacher)  ?student=<username>[&id=<gameId>]  -> removes one game, or all of them
// Redis key: g:<username> = { v:1, list:[ game ] } (newest 30). Erasing a child's data (attempts.js DELETE) removes it too.
// What is stored is facts (squares, moves, short tag words), not sentences: the app writes the explanation text itself.
export const MAX_GAMES = 30;
const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const str = (v, n) => String(v == null ? "" : v).replace(/[<>\u0000-\u001f]/g, "").trim().slice(0, n);
const int = (v, lo, hi) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, Math.round(+v))) : lo);
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/, SQ = /^[a-h][1-8]$/, ID = /^[0-9a-f]{16}$/, THEME = /^[A-Za-z0-9]{2,32}$/, FEN = /^[pnbrqkPNBRQK1-8/]+ [wb] [KQkq-]{1,4} (-|[a-h][36]) \d{1,3} \d{1,4}$/;
const word = (v) => { const w = String(v == null ? "" : v).slice(0, 12); return /^[a-z]*$/.test(w) ? w : ""; };

function cleanTag(t) {
  if (!t || typeof t !== "object" || !THEME.test(String(t.id || ""))) return null;
  const kind = ["missed", "allowed", "moved", "left"].includes(t.kind) ? t.kind : "missed";
  const o = { id: String(t.id), kind };
  if (t.n != null) o.n = int(t.n, 1, 9);
  for (const k of ["pc", "x", "y", "by"]) if (t[k] != null) o[k] = word(t[k]);
  if (t.sq != null && SQ.test(String(t.sq))) o.sq = String(t.sq);
  if (t.defended != null) o.defended = !!t.defended;
  return o;
}
function cleanMistake(m) {
  if (!m || typeof m !== "object" || !UCI.test(String(m.uci)) || !FEN.test(String(m.fen || "")) || !m.best || !UCI.test(String(m.best.uci))) return null;
  return {
    ply: int(m.ply, 1, 400), no: int(m.no, 1, 200), color: m.color === "b" ? "b" : "w",
    san: str(m.san, 10), uci: String(m.uci), fen: String(m.fen), loss: int(m.loss, 0, 3000),
    best: { uci: String(m.best.uci), san: str(m.best.san, 10) }, reply: str(m.reply, 10), tag: cleanTag(m.tag),
  };
}
export function cleanGame(g, now = Date.now()) {
  if (!g || typeof g !== "object" || !ID.test(String(g.id || ""))) return null;
  const mist = (Array.isArray(g.mist) ? g.mist : []).slice(0, 5).map(cleanMistake).filter(Boolean);
  return {
    id: String(g.id), at: now, white: str(g.white, 40), black: str(g.black, 40), date: str(g.date, 10),
    result: ["1-0", "0-1", "1/2-1/2", "*"].includes(g.result) ? g.result : "*", color: g.color === "b" ? "b" : "w",
    checked: int(g.checked, 0, 300), depth: int(g.depth, 1, 30), mist,
  };
}

export default handler(async ({ req, body, query }) => {
  const me = await whoIs(req);
  if (req.method === "POST") {
    if (me.role !== "student") throw new HttpError(403, "Only students can save a game check.");
    if ((+(await kv("GET", "reset:" + me.id)) || 0) > (+(body && body.resetAck) || 0)) throw new HttpError(409, "Your data was erased by your parent or teacher.", "reset");
    const game = cleanGame(body && body.game);
    if (!game) throw new HttpError(400, "That game check could not be saved.");
    const rec = parse(await kv("GET", "g:" + me.id)) || { v: 1, list: [] };
    if (!Array.isArray(rec.list)) rec.list = [];
    if (rec.list.some((x) => x.id === game.id)) return { saved: false, duplicate: true };
    rec.list.unshift(game); rec.list = rec.list.slice(0, MAX_GAMES);
    // each tagged mistake counts as one missed attempt of that theme, so the weakness tracker learns from real games too
    const at = parseRecord(await kv("GET", "at:" + me.id)), day = /^\d{4}-\d{2}-\d{2}$/.test(String(body.d)) ? body.d : new Date().toISOString().slice(0, 10);
    const attempts = game.mist.filter((m) => m.tag).map((m) => ({ k: "g" + game.id.slice(0, 10) + m.ply, id: "G" + game.id.slice(0, 8), th: m.tag.id, ok: 0, s: 0, t: game.at, d: day }));
    const counted = addAttempts(at, attempts);
    await kvPipe([["SET", "g:" + me.id, JSON.stringify(rec)], ...(counted ? [["SET", "at:" + me.id, JSON.stringify(at)]] : [])]);
    return { saved: true, counted };
  }
  const child = await whose(me, query);
  if (req.method === "DELETE") {
    if (me.role === "student") throw new HttpError(403, "Ask your parent or teacher to delete games.");
    const id = String(query.id || "");
    if (!id) { await kv("DEL", "g:" + child.username); return { ok: true }; }
    const rec = parse(await kv("GET", "g:" + child.username)) || { list: [] };
    rec.list = (rec.list || []).filter((x) => x.id !== id);
    await kv("SET", "g:" + child.username, JSON.stringify(rec));
    return { ok: true };
  }
  if (req.method !== "GET") throw new HttpError(405, "Use GET, POST or DELETE.");
  const rec = parse(await kv("GET", "g:" + child.username));
  return { games: rec && Array.isArray(rec.list) ? rec.list : [] };
}, { needs: ["base", "db"] });
