// Sathi Check (Phase 4): the squares shown for "Can I give check? / capture? / what is in danger?": npm test
import assert from "node:assert/strict";
import fs from "node:fs";
import pkg from "chess.js";
const { Chess } = pkg;

// check.js works in the browser and in node; in this ES-module project load it the plain way (same as doctor.js)
const mod = { exports: {} };
new Function("module", "exports", fs.readFileSync("public/teach/check.js", "utf8"))(mod, mod.exports);
const C = mod.exports;
const sq = (fen, kind) => C.squares(Chess, fen, kind);
const sorted = (a) => [...a].sort();

// ---------- checks ----------
// White rook a1 + king e1 against king e8: only Ra8+ gives check, so only the rook's square is shown
let r = sq("4k3/8/8/8/8/8/8/R3K3 w - - 0 1", "checks");
assert.deepEqual(r.squares, ["a1"]); assert.equal(r.n, 1); assert.match(r.say, /1 checking move/);
// Scholar's mate set-up: Qxf7# and Bxf7+ are checks, so queen h5 and bishop c4 are shown
const SCH = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
r = sq(SCH, "checks");
assert.deepEqual(sorted(r.squares), ["c4", "h5"]);
// nothing to show is a normal answer, with a kind sentence
r = sq("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "checks");
assert.deepEqual(r.squares, []); assert.match(r.say, /no checking move/);

// ---------- captures ----------
// Qxf7 is mate: black cannot take back, so f7 is "loose". Also Bxf7+ (the king takes back) must not hide that: one safe way is enough.
r = sq(SCH, "captures");
assert.ok(r.squares.includes("f7")); assert.ok(r.loose.includes("f7"));
// Pawn d4 can take e5, but a knight on f7 guards e5: shown, and NOT loose
r = sq("4k3/5n2/8/4p3/3P4/8/8/4K3 w - - 0 1", "captures");
assert.deepEqual(r.squares, ["e5"]); assert.deepEqual(r.loose, []); assert.match(r.say, /guarded/);
// Same pawn, no guard: loose
r = sq("4k3/8/8/4p3/3P4/8/8/4K3 w - - 0 1", "captures");
assert.deepEqual(r.loose, ["e5"]);
// Capturing the king is never offered
assert.deepEqual(sq("4k3/8/8/8/8/8/8/R3K3 w - - 0 1", "captures").squares, []);

// ---------- threats ----------
// Black queen d5 attacks the unguarded pawn e4: it is in danger
r = sq("4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1", "threats");
assert.deepEqual(r.squares, ["e4"]);
// A guarded pawn attacked by a QUEEN is not flagged: taking it would cost the queen
r = sq("4k3/8/8/3q4/4P3/5P2/8/4K3 w - - 0 1", "threats");
assert.deepEqual(r.squares, [], "e4 is guarded by f3, and a queen taking a pawn loses the queen");
// A guarded queen attacked by a pawn IS in danger: it is worth more than the pawn
r = sq("4k3/8/8/3p4/4Q3/8/8/4K3 w - - 0 1", "threats");
assert.deepEqual(r.squares, ["e4"]);
// The start position: nothing is in danger
assert.deepEqual(sq("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "threats").squares, []);

// ---------- strange input must never throw ----------
assert.deepEqual(sq("not a fen", "checks").squares, []);
assert.deepEqual(sq(SCH, "nonsense").squares, []);
console.log("check.test.mjs: ok");
