// Makes ORIGINAL tactics puzzles with Stockfish (no outside source).   node tools/moodimport/generate.mjs [minutes=10]
// 1. Engines play many quick, slightly careless games (so real mistakes and tactics appear).
// 2. After every move, the side to move is checked: is there ONE clearly winning move (Stockfish depth 14)?
// 3. The winning line is cut to at most 3 of our moves; the opponent's last real move is the puzzle's "setup move" (no invented move needed).
// 4. Detectors name the idea (counter check, underpromotion, Greek gift, desperado, zwischenzug). Hardness = how deep the engine must look.
// Output: appends one JSON line per puzzle to tools/moodimport/generated.jsonl (kept in the repo, so the run can be reviewed). Safe to run again.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { unMove } from "./convert.mjs";
const require = createRequire(import.meta.url.replace("tools/moodimport/generate.mjs", "package.json"));
const { Chess } = require("chess.js");

const MINUTES = +(process.argv[2] || 10), WORKERS = +(process.env.WORKERS || 4), OUT = new URL("./generated.jsonl", import.meta.url);
const uciOf = (m) => m.from + m.to + (m.promotion || "");
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

async function engine() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-"));
  for (const f of ["stockfish-18-lite-single.js", "stockfish-18-lite-single.wasm"]) fs.copyFileSync("public/stockfish/" + f, path.join(dir, f));
  fs.writeFileSync(path.join(dir, "package.json"), '{"type":"commonjs"}');
  const p = spawn(process.execPath, [path.join(dir, "stockfish-18-lite-single.js")]);
  let buf = "", wait = null, mpv = 1;
  p.stdout.on("data", (d) => { buf += d; if (wait && wait.re.test(buf)) { const w = wait; wait = null; w.res(buf); } });
  const until = (re) => new Promise((res, rej) => { if (re.test(buf)) return res(buf); wait = { re, res }; setTimeout(() => rej(new Error("engine timeout")), 60000); });
  p.stdin.write("uci\n"); await until(/uciok/);
  /** [{move, score}] best first, score for the side to move (mate = +-100000) */
  const ask = async (fen, depth, n = 2) => {
    if (n !== mpv) { p.stdin.write(`setoption name MultiPV value ${n}\nisready\n`); await until(/readyok/); mpv = n; }
    buf = ""; p.stdin.write(`position fen ${fen}\ngo depth ${depth}\n`); const out = await until(/bestmove/), by = {};
    for (const l of out.split("\n")) { const m = l.match(/ depth (\d+) .* multipv (\d+) .*score (cp|mate) (-?\d+).* pv (\S+)/); if (m) by[m[2]] = { move: m[5], score: m[3] === "mate" ? (+m[4] > 0 ? 100000 - +m[4] : -100000 - +m[4]) : +m[4] }; }
    return Object.keys(by).sort().map((k) => by[k]);
  };
  return { ask, close: () => p.kill() };
}

/* ---------- idea detectors: (position after the setup move, kid's moves as verbose chess.js moves, setup move) ---------- */
function attackedBy(fen, sq) {            // can the side NOT to move capture the piece on sq? (flip the turn and look)
  const p = fen.split(" "); p[1] = p[1] === "w" ? "b" : "w"; p[3] = "-"; const g = new Chess(p.join(" ")); if (!g.fen()) return false;
  return g.moves({ verbose: true }).some((m) => m.to === sq);
}
export function detect(fen, kidMoves, setup) {
  const t = [], first = kidMoves[0], g = new Chess(fen);
  if (g.in_check() && /\+/.test(first.san)) t.push("counterCheck");
  if (kidMoves.some((m) => m.promotion && m.promotion !== "q")) t.push("underpromotion");
  if (first.piece === "b" && first.captured === "p" && /[h][27]/.test(first.to) && /\+/.test(first.san)) t.push("greekGift");
  if (first.captured && first.piece !== "k" && first.piece !== "p" && attackedBy(fen, first.from) && VAL[first.captured] >= 3 && VAL[first.piece] >= VAL[first.captured]) t.push("desperado");
  if (setup && setup.captured && first.to !== setup.to && (/\+/.test(first.san) || first.captured) && kidMoves.slice(1).some((m) => m.to === setup.to)) t.push("zwischenzug");
  return t;
}

/* ---------- one position -> puzzle or null ---------- */
async function mine(sf, preFen, setup) {
  const g = new Chess(preFen); const sm = g.move({ from: setup.slice(0, 2), to: setup.slice(2, 4), promotion: setup[4] }); if (!sm) return null;
  const start = g.fen();
  if (g.game_over() || g.moves().length < 2) return null;
  const quick = await sf.ask(start, 8); if (!quick[0] || quick[0].score < 150 || (quick[1] && quick[0].score - quick[1].score < 120)) return null;     // cheap screen
  const keep = [], kids = [], line = new Chess(start); let firstTop = null;
  for (let k = 0; k < 3; k++) {
    const top = await sf.ask(line.fen(), 14); if (!top[0]) break;
    const clear = top[0].score >= 250 && (!top[1] || (top[0].score - top[1].score >= 200 && top[1].score < 90000));
    if (!clear) break; if (!firstTop) firstTop = top;
    const km = line.move({ from: top[0].move.slice(0, 2), to: top[0].move.slice(2, 4), promotion: top[0].move[4] }); if (!km) break;
    keep.push(uciOf(km)); kids.push(km);
    if (line.game_over()) break;
    const rep = await sf.ask(line.fen(), 12, 1); if (!rep[0]) break;
    const rm = line.move({ from: rep[0].move.slice(0, 2), to: rep[0].move.slice(2, 4), promotion: rep[0].move[4] }); if (!rm) break;
    if (k < 2 && !line.game_over()) keep.push(uciOf(rm)); else { line.undo(); break; }          // line must END on our move
    if (line.game_over()) { keep.pop(); break; }
  }
  if (!kids.length) return null;
  if (keep.length % 2 === 0) keep.pop();
  const kidMoves = []; { const c = new Chess(start); for (let i = 0; i < keep.length; i++) { const m = c.move({ from: keep[i].slice(0, 2), to: keep[i].slice(2, 4), promotion: keep[i][4] }); if (i % 2 === 0) kidMoves.push(m); } }
  const mate = (() => { const c = new Chess(start); keep.forEach((u) => c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] })); return c.in_checkmate(); })();
  // a real tactic WINS something: our material must go up by 2+ points (or it is mate). This drops "only move" defences and already-won positions.
  const mat = (f, side) => f.split(" ")[0].replace(/[^a-zA-Z]/g, "").split("").reduce((a, c) => a + (VAL[c.toLowerCase()] || 0) * ((c === c.toUpperCase()) === (side === "w") ? 1 : -1), 0);
  { const c = new Chess(start); keep.forEach((u) => c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] })); const side = start.split(" ")[1]; if (!mate && mat(c.fen(), side) - mat(start, side) < 2) return null; }
  // hardness: how many shallow searches MISS the first move (a strong signal for "hard to see")
  let miss = 0; for (const d of [1, 3, 5]) { const s = await sf.ask(start, d, 1); if (!s[0] || s[0].move !== keep[0]) miss++; }
  if (miss < 2) return null;                                   // too easy: even a very shallow search finds it
  const gap = firstTop[1] ? Math.min(1500, firstTop[0].score - firstTop[1].score) : 1500;
  const rating = Math.round(Math.max(900, Math.min(2000, 900 + 120 * miss + 120 * (kidMoves.length - 1) + (gap < 400 ? 150 : gap < 700 ? 60 : 0) + (mate ? 50 : 0))));
  const tags = detect(start, kidMoves, sm);
  return { fen: preFen, moves: [setup, ...keep], rating, themes: tags.join(" "), key: start.split(" ").slice(0, 2).join(" ") };
}

/* ---------- starting positions: mostly a normal game, sometimes a typical middlegame (Greek-gift set-ups) or a random pawn/rook ending ---------- */
const GIFT = ["r1bq1rk1/pp1nbppp/2p1pn2/3p4/2PP4/2NBPN2/PP3PPP/R1BQ1RK1 w - - 0 8", "rnbq1rk1/pp2bppp/4pn2/2pp4/3P1B2/2PBPN2/PP1N1PPP/R2QK2R w KQ - 0 8",
  "r1bq1rk1/ppp1nppp/3p1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 7", "r1bqr1k1/pp1n1ppp/2p2n2/3p4/3P4/2NBPN2/PP3PPP/R1BQ1RK1 w - - 0 10",
  "r2q1rk1/pp1bbppp/2n1pn2/2pp4/3P1B2/2PBPN2/PP1NQPPP/R3K2R w KQ - 0 9"];
function endingSeed(rich) {
  for (;;) {
    const sq = () => "abcdefgh"[Math.floor(Math.random() * 8)] + (1 + Math.floor(Math.random() * 8)), put = {};
    const place = (c, ranks) => { for (let i = 0; i < 50; i++) { const s = sq(); if (!put[s] && (!ranks || ranks.includes(+s[1]))) { put[s] = c; return; } } };
    place("K"); place("k"); place("P", [6, 7]); place("p", [2, 3]); if (Math.random() < 0.7) place("R"); if (Math.random() < 0.7) place("r"); if (Math.random() < 0.3) place("N"); if (Math.random() < 0.3) place("b");
    if (rich) { if (Math.random() < 0.5) place("Q"); if (Math.random() < 0.5) place("q"); if (Math.random() < 0.5) place("p", [2, 3, 4]); if (Math.random() < 0.5) place("P", [4, 5, 6, 7]); if (Math.random() < 0.4) place("B"); }
    const rows = []; for (let r = 8; r >= 1; r--) { let row = "", n = 0; for (const f of "abcdefgh") { const c = put[f + r]; if (!c) n++; else { if (n) row += n; n = 0; row += c; } } rows.push(row + (n || "")); }
    const fen = rows.join("/") + " w - - 0 1", g = new Chess(fen); if (g.fen() && Object.values(put).filter((c) => c === "K" || c === "k").length === 2 && (rich || !g.in_check())) { const o = new Chess(fen.replace(" w ", " b ")); if (o.fen() && !o.in_check()) return fen; }
  }
}
const pickStart = () => { const r = Math.random(); return r < 0.25 ? { fen: GIFT[Math.floor(Math.random() * GIFT.length)], seed: true } : r < 0.5 ? { fen: endingSeed(), seed: true } : { fen: undefined, seed: false }; };

/* ---------- play careless games and mine them ---------- */
async function ideaWorker(sf, until, seen, id) {          // IDEAS=1: mine random endings directly (rare ideas such as underpromotion and counter check)
  let tried = 0, found = 0;
  while (Date.now() < until) {
    const seed = endingSeed(true), un = unMove(seed); if (!un) continue; tried++;
    const r = await mine(sf, un.fen, un.uci);
    if (r && !seen.has(r.key)) { seen.add(r.key); found++; fs.appendFileSync(OUT, JSON.stringify({ id: `oi${id}-${tried}`, ...r }) + "\n"); }
  }
  return { games: tried, found };
}
async function worker(sf, until, seen, id) {
  if (process.env.IDEAS) return ideaWorker(sf, until, seen, id);
  let games = 0, found = 0;
  while (Date.now() < until) {
    const st = pickStart(), g = st.fen ? new Chess(st.fen) : new Chess(); games++;
    for (let ply = 0; ply < 110 && Date.now() < until && !g.game_over(); ply++) {
      const moves = g.moves({ verbose: true }); if (!moves.length) break;
      const before = g.fen(); let pick;
      if (ply < 8 && !st.seed) pick = moves[Math.floor(Math.random() * moves.length)];
      else { const top = await sf.ask(before, 3, 4); const ok = top.filter((t) => t.score > top[0].score - 150); const c = ok[Math.floor(Math.random() * ok.length)] || top[0]; pick = moves.find((m) => uciOf(m) === c.move) || moves[0]; }
      g.move(pick);
      if (ply >= (st.seed ? 1 : 10) && g.moves().length > 1 && !g.game_over()) {      // the side now to move might have a puzzle: the move just played is the setup
        const r = await mine(sf, before, uciOf(pick));
        if (r && !seen.has(r.key)) { seen.add(r.key); found++; fs.appendFileSync(OUT, JSON.stringify({ id: `og${id}-${games}-${ply}`, ...r }) + "\n"); }
      }
    }
  }
  return { games, found };
}
if (process.argv[1] && process.argv[1].endsWith("generate.mjs")) {
  const until = Date.now() + MINUTES * 60000, seen = new Set();
  if (fs.existsSync(OUT)) fs.readFileSync(OUT, "utf8").split("\n").filter(Boolean).forEach((l) => seen.add(JSON.parse(l).key));
  console.log(`generating for ${MINUTES} min with ${WORKERS} engines (already have ${seen.size})...`);
  const res = await Promise.all(Array.from({ length: WORKERS }, async (_, i) => { const sf = await engine(); const r = await worker(sf, until, seen, i + 1); sf.close(); return r; }));
  console.log("games", res.reduce((a, r) => a + r.games, 0), "new puzzles", res.reduce((a, r) => a + r.found, 0));
}
