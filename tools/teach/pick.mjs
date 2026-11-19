// Fills the example position ("ex") of every lesson card in public/teach/themes.json
// with a real Lichess puzzle (CC0) from public/levels.json. Run: node tools/teach/pick.mjs
// Only fills themes that have no "ex" yet, so a hand-picked example is never overwritten.
// Picks the cleanest puzzle for the theme (fewest other themes), then the lowest rating, then the shortest line.
import fs from "node:fs";
import pkg from "chess.js";
const { Chess } = pkg;

const SKIP = /^(short|long|veryLong|oneMove|middlegame|endgame|opening|advantage|crushing|equality|master|masterVsMaster|superGM|mate)$/;
const MATE_N = { mateIn1: 1, mateIn2: 2, mateIn3: 3 };
const levels = JSON.parse(fs.readFileSync("public/levels.json", "utf8")).levels;
const file = "public/teach/themes.json";
const data = JSON.parse(fs.readFileSync(file, "utf8"));

const all = levels.flat().map(([id, fen, moves, rating, themes]) => ({ id, fen, moves: moves.split(" "), rating, themes: themes.split(" ").filter((t) => t && !SKIP.test(t)) }));

// Replays the puzzle: moves[0] is the opponent's move, the rest is the solution. Returns the example or null.
export function build(p, theme) {
  const g = new Chess(p.fen);
  const first = p.moves[0];
  if (!g.move({ from: first.slice(0, 2), to: first.slice(2, 4), promotion: first[4] })) return null;
  const fen = g.fen(), color = g.turn();
  const rest = p.moves.slice(1);
  let last = null;
  for (const u of rest) { last = g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); if (!last) return null; }
  if (MATE_N[theme] && !g.in_checkmate()) return null;
  return { id: p.id, rating: p.rating, fen, color, moves: rest };
}

let filled = 0;
for (const [key, t] of Object.entries(data.themes)) {
  if (!t.steps || t.ex) continue;
  const maxLen = MATE_N[key] ? 2 * MATE_N[key] : 4; // opponent's move + our moves and their replies
  const find = (limit) => all.filter((p) => p.themes.includes(key) && p.moves.length <= limit + 1)
    .sort((a, b) => a.themes.length - b.themes.length || a.rating - b.rating || a.moves.length - b.moves.length);
  let pool = find(maxLen), ex = null;
  for (const p of pool) { ex = build(p, key); if (ex) break; }
  if (!ex) { pool = find(maxLen + 2); for (const p of pool) { ex = build(p, key); if (ex) break; } } // short examples are best, but a longer one beats none
  if (!ex) { console.log("NO EXAMPLE for", key, "(pool", pool.length + ")"); continue; }
  t.ex = ex; filled++;
  console.log(key.padEnd(18), ex.id, ex.rating, ex.moves.length, "moves");
}
fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
console.log("filled", filled);
