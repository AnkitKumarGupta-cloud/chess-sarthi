// Checks the teaching content (public/teach/themes.json) against the real puzzles: npm test
import assert from "node:assert/strict";
import fs from "node:fs";
import pkg from "chess.js";
const { Chess } = pkg;

const SKIP = /^(short|long|veryLong|oneMove|middlegame|endgame|opening|advantage|crushing|equality|master|masterVsMaster|superGM|mate)$/;
const MATE_N = { mateIn1: 1, mateIn2: 2, mateIn3: 3 };
const data = JSON.parse(fs.readFileSync("public/teach/themes.json", "utf8"));
const levels = JSON.parse(fs.readFileSync("public/levels.json", "utf8")).levels;
const T = data.themes;
const short = (s, max, what, min = 6) => { assert.equal(typeof s, "string", what + " must be text"); assert.ok(s.length >= min && s.length <= max, `${what} must be ${min}-${max} characters (is ${s.length}): ${s}`); };

// Sathi Check: the three questions every coach teaches, plus the optional blunder check
assert.deepEqual(data.check.map((c) => c.id), ["checks", "captures", "threats", "blunder"]);
assert.equal(data.check[3].optional, true);
for (const c of data.check) { short(c.q, 90, "check question"); short(c.hint, 200, "check hint"); }

// Every theme that appears at least 10 times in the puzzles has words
const count = {};
for (const lv of levels) for (const p of lv) for (const t of p[4].split(" ")) if (t && !SKIP.test(t)) count[t] = (count[t] || 0) + 1;
const missing = Object.keys(count).filter((t) => count[t] >= 10 && !T[t]);
assert.deepEqual(missing, [], "themes with 10+ puzzles and no explanation: " + missing.join(", "));

const ranks = new Set();
let lessons = 0;
for (const [id, t] of Object.entries(T)) {
  assert.ok(/^[A-Za-z0-9]+$/.test(id), "theme id " + id);
  short(t.name, 30, id + " name", 3); short(t.what, 160, id + " what"); short(t.spot, 200, id + " spot");
  short(t.remember, 80, id + " remember"); short(t.why, 260, id + " why");
  assert.ok(Number.isInteger(t.rank), id + " needs a rank"); assert.ok(!ranks.has(t.rank), id + " rank " + t.rank + " is used twice"); ranks.add(t.rank);
  if (!t.steps) { assert.ok(!t.ex, id + " has an example but no lesson steps"); continue; }
  lessons++;
  assert.equal(t.steps.length, 3, id + " lesson needs exactly 3 steps");
  t.steps.forEach((s, i) => short(s, 160, id + " step " + (i + 1)));
  // The example: a real Lichess puzzle position; every move must be legal and mate themes must end in mate
  const ex = t.ex; assert.ok(ex && ex.fen && Array.isArray(ex.moves) && ex.moves.length, id + " lesson needs an example (run node tools/teach/pick.mjs)");
  const g = new Chess(ex.fen); assert.ok(g.fen(), id + " bad example position");
  assert.equal(g.turn(), ex.color, id + " example side to move");
  for (const u of ex.moves) assert.ok(g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }), id + " illegal example move " + u);
  if (MATE_N[id]) assert.ok(g.in_checkmate(), id + " example must end in checkmate");
  const src = levels.flat().find((p) => p[0] === ex.id); assert.ok(src && src[4].split(" ").includes(id), id + " example " + ex.id + " is not a Lichess puzzle with that theme");
}
assert.ok(lessons >= 30, "at least 30 lesson cards (have " + lessons + ")");
console.log(`Teaching content checks passed (${Object.keys(T).length} themes, ${lessons} lesson cards).`);
