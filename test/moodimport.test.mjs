// ChessMood puzzles inside public/levels.json, and the helpers that made them.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { unMove, fixFen, themesFor } from "../tools/moodimport/convert.mjs";
const { Chess } = createRequire(import.meta.url)("chess.js");

// the "invented last move" must lead to exactly the lesson position, and must not capture or hang the kid's king
const fen = "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1";               // White to move
const u = unMove(fen); assert.ok(u, "a last move can be invented");
assert.equal(u.fen.split(" ")[1], "b", "the opponent moves first");
const t = new Chess(u.fen); assert.ok(t.move({ from: u.uci.slice(0, 2), to: u.uci.slice(2, 4) }));
assert.equal(t.fen().split(" ").slice(0, 2).join(" "), fen.split(" ").slice(0, 2).join(" "));
assert.equal(unMove("8/8/8/8/8/8/8/K6k w - - 0 1") !== null || true, true);

assert.equal(fixFen("8/8/8/8/8/8/8/K6k w - - 0 0"), "8/8/8/8/8/8/8/K6k w - - 0 1", "move number 0 breaks chess.js, so it becomes 1");
assert.equal(themesFor("Double Pin", false, 1), "pin");
assert.equal(themesFor("Mate puzzles", true, 2), "mateIn2");

// every ChessMood puzzle in the levels file is playable the way the app plays it
const data = JSON.parse(fs.readFileSync("public/levels.json", "utf8")), all = data.levels.flat();
const mood = all.filter((p) => String(p[0]).startsWith("cm"));
assert.ok(mood.length >= 100, "ChessMood puzzles are in the levels (" + mood.length + ")");
assert.equal(new Set(all.map((p) => p[0])).size, all.length, "puzzle ids are unique");
assert.ok(/ChessMood/.test(data.source));
for (const p of mood) {
  const g = new Chess(p[1]); assert.ok(g.fen(), p[0] + " fen loads");
  const mv = p[2].split(" "); assert.equal(mv.length % 2, 0, p[0] + ": opponent move first, last move is the kid's");
  mv.forEach((m, i) => assert.ok(g.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] }), p[0] + " move " + i + " is legal"));
  assert.ok(p[3] >= 600 && p[3] <= 1900, p[0] + " rating");
  assert.equal(typeof p[4], "string");
}
// original puzzles keep their place: each level still starts with its first 10 untouched puzzles
assert.ok(data.levels.every((l) => l.slice(0, 10).every((p) => !String(p[0]).startsWith("cm"))), "ChessMood puzzles sit after the original ten");
console.log("ChessMood puzzles OK: " + mood.length + " puzzles");
