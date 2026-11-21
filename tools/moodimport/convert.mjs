// ChessMood lesson PGNs -> puzzles in the app's format.      node tools/moodimport/convert.mjs <folder with .pgn files>
// Writes tools/moodimport/puzzles.json (reviewed list, committed) - merge.mjs then puts it into public/levels.json.
//
// WHY THIS IS NEEDED
//  * The files are LESSONS, not puzzles. A position is only kept if the kid's move is the clear best move
//    (Stockfish says so by a big margin) - otherwise the app would mark a good alternative move as wrong.
//  * Lessons start with the kid to move. The app (like Lichess) starts with the OPPONENT's last move, so we
//    invent a believable last move for the opponent ("un-move" a piece one step back). It is checked with chess.js.
//  * Long lesson lines are cut after at most 6 kid moves, always ending on a kid move.
// Permission: the user (Gupta Chess Academy) has ChessMood's permission to use these. No credit is shown in the app.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url.replace("tools/moodimport/convert.mjs", "package.json"));
const { Chess } = require("chess.js");

const DEPTH = 12, GAP = 150, MAX_KID_MOVES = 6, WORKERS = 4;

/* ---------- reading the PGN (main line only; comments, variations and symbols dropped) ---------- */
export function parseFile(file) {
  const txt = fs.readFileSync(file, "utf8").replace(/\r/g, "");
  const blocks = txt.split(/\n(?=\[Event )/).filter((b) => b.trim().startsWith("[Event"));
  return blocks.map((b) => {
    const tags = {}; for (const m of b.matchAll(/^\[(\w+) "(.*)"\]$/gm)) tags[m[1]] = m[2];
    let body = b.split(/\n\n/).slice(1).join("\n\n").replace(/\{[^}]*\}/g, " ");
    let out = "", depth = 0; for (const ch of body) { if (ch === "(") depth++; else if (ch === ")") depth--; else if (!depth) out += ch; }
    const toks = out.replace(/\$\d+/g, " ").replace(/\d+\.(\.\.)?/g, " ").replace(/\*|1-0|0-1|1\/2-1\/2/g, " ").split(/\s+/).filter(Boolean);
    const moves = []; for (const t of toks) { if (t === "Z0") break; moves.push(t.replace(/[!?]+$/, "")); }
    return { tags, fen: tags.FEN || null, moves, title: [tags.White, tags.Black, tags.Event].filter((x) => x && x !== "?").join(" | ") };
  });
}

/* ---------- small chess helpers ---------- */
const placement = (fen) => fen.split(" ").slice(0, 2).join(" ");
const uciOf = (m) => m.from + m.to + (m.promotion || "");
export function fixFen(fen) { const p = fen.trim().split(/\s+/); if (p.length < 4) return null; while (p.length < 6) p.push(p.length === 4 ? "0" : "1"); if (+p[5] < 1) p[5] = "1"; return p.join(" "); }

/** Invents the opponent's last move. Returns { fen, uci } where fen = the position BEFORE that move (opponent to move). */
export function unMove(fen) {
  const g = new Chess(fen); if (!g.fen()) return null;
  const castle = fen.split(" ")[2];
  if (fen.split(" ")[3] !== "-") return null;                                                       // en passant: the last move must be a pawn move, which we do not invent
  const kid = g.turn(), opp = kid === "w" ? "b" : "w", rows = fen.split(" ")[0].split("/");
  const board = rows.map((r) => [...r].flatMap((c) => (/\d/.test(c) ? Array(+c).fill(null) : [c])));
  const sq = (r, f) => "abcdefgh"[f] + (8 - r);
  const mine = (c) => c && (opp === "w" ? c === c.toUpperCase() : c === c.toLowerCase());
  const order = { n: 0, b: 1, r: 2, q: 3, k: 4 }, cands = [];
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const c = board[r][f]; if (!mine(c) || /p/i.test(c) || (castle !== "-" && /[kr]/i.test(c))) continue;   // moving a king or rook back could break castling rights
    for (let r2 = 0; r2 < 8; r2++) for (let f2 = 0; f2 < 8; f2++) if (!board[r2][f2]) cands.push({ r, f, r2, f2, c, d: Math.max(Math.abs(r - r2), Math.abs(f - f2)) });
  }
  cands.sort((a, b) => (order[a.c.toLowerCase()] - order[b.c.toLowerCase()]) || a.d - b.d);
  const fullmove = Math.max(1, +fen.split(" ")[5] - (kid === "w" ? 1 : 0));
  for (const x of cands) {
    const b2 = board.map((r) => r.slice()); b2[x.r][x.f] = null; b2[x.r2][x.f2] = x.c;           // piece stood on (r2,f2) BEFORE
    const place = b2.map((r) => { let s = "", n = 0; for (const c of r) { if (!c) n++; else { if (n) s += n; n = 0; s += c } } return s + (n || "") }).join("/");
    const pre = `${place} ${opp} ${castle} - 0 ${fullmove}`;
    const kidView = new Chess(`${place} ${kid} ${castle} - 0 ${fullmove}`);
    if (!kidView.fen() || kidView.in_check()) continue;                                             // the kid's king must not be hanging before the move
    const t = new Chess(pre); if (!t.fen()) continue;
    const mv = t.move({ from: sq(x.r2, x.f2), to: sq(x.r, x.f) }); if (!mv || mv.captured) continue;
    if (placement(t.fen()) !== placement(fen)) continue;
    if (t.in_check() !== g.in_check()) continue;
    return { fen: pre, uci: uciOf(mv) };
  }
  return null;
}

/* ---------- theme tags from the lesson headings (only ids that exist in themes.json or the Lichess set) ---------- */
const WORDS = [[/skewer/i, "skewer"], [/pin/i, "pin"], [/fork|double attack/i, "fork"], [/deflect/i, "deflection"], [/attract|decoy/i, "attraction"],
  [/discover/i, "discoveredAttack"], [/double check/i, "doubleCheck"], [/clearance/i, "clearance"], [/x-?ray/i, "xRayAttack"], [/zwischen|intermezzo/i, "intermezzo"],
  [/back.?rank/i, "backRankMate"], [/trapped|trapping/i, "trappedPiece"], [/sacrific/i, "sacrifice"], [/smothered/i, "smotheredMate"], [/ep[a]?l?u?ette/i, "epauletteMate"],
  [/anastasia/i, "anastasiaMate"], [/arabian/i, "arabianMate"], [/opera/i, "operaMate"], [/dovetail/i, "dovetailMate"], [/boden/i, "bodenMate"], [/hook/i, "hookMate"],
  [/pillsbury/i, "pillsburysMate"], [/hanging|blunder/i, "hangingPiece"], [/quiet/i, "quietMove"], [/zugzwang/i, "zugzwang"], [/promot/i, "promotion"]];
export function themesFor(heading, endsInMate, kidMoves) {
  const t = [];
  if (endsInMate) t.push("mateIn" + Math.min(5, kidMoves));
  for (const [re, id] of WORDS) if (re.test(heading) && !t.includes(id)) t.push(id);
  return t.slice(0, 3).join(" ");
}

/* ---------- Stockfish in node (same engine file as test/doctor.test.mjs) ---------- */
async function engine() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-"));
  for (const f of ["stockfish-18-lite-single.js", "stockfish-18-lite-single.wasm"]) fs.copyFileSync("public/stockfish/" + f, path.join(dir, f));
  fs.writeFileSync(path.join(dir, "package.json"), '{"type":"commonjs"}');
  const p = spawn(process.execPath, [path.join(dir, "stockfish-18-lite-single.js")]);
  let buf = "", wait = null;
  p.stdout.on("data", (d) => { buf += d; if (wait && wait.re.test(buf)) { const w = wait; wait = null; w.res(buf); } });
  const until = (re) => new Promise((res, rej) => { if (re.test(buf)) return res(buf); wait = { re, res }; setTimeout(() => rej(new Error("engine timeout")), 60000); });
  p.stdin.write("uci\n"); await until(/uciok/); p.stdin.write("setoption name MultiPV value 2\nisready\n"); await until(/readyok/);
  /** returns [{move, score}] best first; score is for the side to move (mate = +/-100000-n) */
  const ask = async (fen) => {
    buf = ""; p.stdin.write(`position fen ${fen}\ngo depth ${DEPTH}\n`); const out = await until(/bestmove/);
    const by = {};
    for (const l of out.split("\n")) { const m = l.match(/ multipv (\d+) .*score (cp|mate) (-?\d+).* pv (\S+)/); if (m) by[m[1]] = { move: m[4], score: m[2] === "mate" ? (+m[3] > 0 ? 100000 - +m[3] : -100000 - +m[3]) : +m[3] }; }
    return [by[1], by[2]].filter(Boolean);
  };
  return { ask, close: () => p.kill() };
}

/** The WHOLE lesson line (up to 6 kid moves) as a goal-only puzzle: the kid may find other good moves, the app only checks the result with Stockfish.
 *  Kept when the lesson line really wins: mate, or the kid is clearly winning at the end and gained material (or the line is 3+ moves long). */
async function lessonGoal(g, fens, uci, ask, heading) {
  const n = Math.min(uci.length, MAX_KID_MOVES * 2 - 1), cut = n % 2 === 0 ? n - 1 : n;   // end on a kid move
  if (cut < 1) return null;
  const kid = fens[0].split(" ")[1], end = fens[cut], e = new Chess(end), kidMoves = (cut + 1) / 2;
  const mate = e.in_checkmate(); let score = 100000;
  if (!mate) { const top = await ask(end); if (!top[0]) return null; score = -top[0].score; const s0 = (await ask(fens[0]))[0]; if (!s0 || s0.score < 200 || score < 200) return null; }
  const mat = (f) => f.split(" ")[0].replace(/[^a-zA-Z]/g, "").split("").reduce((a, c) => a + ({ p: 1, n: 3, b: 3, r: 5, q: 9 }[c.toLowerCase()] || 0) * ((c === c.toUpperCase()) === (kid === "w") ? 1 : -1), 0);
  if (!mate && mat(end) - mat(fens[0]) < 1 && kidMoves < 3) return null;
  return { fen: fens[0], moves: uci.slice(0, cut), kidFirst: true, score, rating: Math.max(700, Math.min(2000, 700 + 230 * (kidMoves - 1) + (mate ? -50 : 0))), themes: themesFor(heading + " " + (g.title || ""), mate, kidMoves), key: placement(fens[0]) };
}

/* ---------- one lesson position -> puzzle (or null with a reason) ---------- */
async function convertOne(g, heading, ask) {
  const fen = fixFen(g.fen || ""); if (!fen) return { skip: "no position" };
  const c = new Chess(fen); if (!c.fen()) return { skip: "illegal position" };
  if (!g.moves.length) return { skip: "no moves" };
  const uci = [], fens = [fen];
  for (const s of g.moves) { const m = c.move(s, { sloppy: true }); if (!m) break; uci.push(uciOf(m)); fens.push(c.fen()); if (c.game_over()) break; }
  if (!uci.length) return { skip: "illegal move" };
  const keep = []; let gap = 9999, firstScore = 0;
  for (let i = 0; i < uci.length && keep.length < MAX_KID_MOVES * 2; i += 2) {        // i = a kid move
    const top = await ask(fens[i]);
    const ok = top[0] && top[0].move === uci[i] && top[0].score >= 100 && (!top[1] || (top[0].score - top[1].score >= GAP && top[1].score < 90000));
    if (!ok) break;
    if (i === 0) { gap = top[1] ? top[0].score - top[1].score : 9999; firstScore = top[0].score; }
    keep.push(uci[i]); if (uci[i + 1]) keep.push(uci[i + 1]);
    if (new Chess(fens[i + 1]).in_checkmate()) break;
  }
  const lesson = await lessonGoal(g, fens, uci, ask, heading);                            // goal-only version (several moves may work), used by Practice
  if (!keep.length) return lesson ? { lesson } : { skip: "not a clear best move" };
  if (keep.length % 2 === 0) keep.pop();                                                // end on a kid move
  const end = new Chess(fens[0]); keep.forEach((u) => end.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }));
  const mate = end.in_checkmate(), kidMoves = (keep.length + 1) / 2;
  const un = unMove(fens[0]); if (!un) return { skip: "no believable last move" };
  const rating = Math.max(600, Math.min(1900, Math.round(650 + 250 * (kidMoves - 1) + Math.max(-100, Math.min(200, 300 - gap / 3)) + (mate ? -50 : 0))));
  return { lesson, puz: { fen: un.fen, moves: [un.uci, ...keep], rating, themes: themesFor(heading + " " + g.title, mate, kidMoves), key: placement(fens[0]) } };
}

/* ---------- main ---------- */
if (process.argv[1] && process.argv[1].endsWith("convert.mjs")) {
  const dir = process.argv[2]; if (!dir) { console.log("usage: node tools/moodimport/convert.mjs <folder with .pgn files>"); process.exit(1); }
  const jobs = []; let fileNo = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".pgn")).sort()) {
    fileNo++; let heading = "";
    parseFile(path.join(dir, f)).forEach((g, i) => { if (!g.fen) { heading = g.title; return; } jobs.push({ id: `cm${fileNo}-${i + 1}`, g, heading }); });
  }
  console.log(jobs.length + " positions to check, " + WORKERS + " engines...");
  const results = new Array(jobs.length), skips = {}; let next = 0, done = 0;
  await Promise.all(Array.from({ length: WORKERS }, async () => {
    const sf = await engine();
    for (;;) { const i = next++; if (i >= jobs.length) break; results[i] = await convertOne(jobs[i].g, jobs[i].heading, sf.ask); if (++done % 100 === 0) console.log(done + "/" + jobs.length); }
    sf.close();
  }));
  const seen = new Set(), puzzles = [], lessons = [], seenL = new Set();
  results.forEach((r, i) => { if (r.lesson && !seenL.has(r.lesson.key)) { seenL.add(r.lesson.key); const { key, ...l } = r.lesson; lessons.push({ id: jobs[i].id + "L", ...l }); }
    if (!r.puz && !r.skip) return;
    if (r.skip) { skips[r.skip] = (skips[r.skip] || 0) + 1; return; } if (seen.has(r.puz.key)) { skips.duplicate = (skips.duplicate || 0) + 1; return; } seen.add(r.puz.key); const { key, ...p } = r.puz; puzzles.push({ id: jobs[i].id, ...p }); });
  puzzles.sort((a, b) => a.rating - b.rating); lessons.sort((a, b) => a.rating - b.rating);
  fs.writeFileSync(new URL("./lessons.json", import.meta.url), JSON.stringify({ source: "ChessMood (used with permission)", lessons }));
  fs.writeFileSync(new URL("./puzzles.json", import.meta.url), JSON.stringify({ source: "ChessMood (used with permission)", puzzles }));
  console.log("goal-only lessons", lessons.length, "| kept", puzzles.length, "skipped", JSON.stringify(skips));
}
