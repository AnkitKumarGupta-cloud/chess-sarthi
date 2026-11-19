// Game doctor: reading games, tagging mistakes, and (when the engine can run in node) a real analysis: npm test
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import pkg from "chess.js";
const { Chess } = pkg;

// doctor.js works in the browser and in node; in this ES-module project load it the plain way
const mod = { exports: {} };
new Function("module", "exports", fs.readFileSync("public/doctor/doctor.js", "utf8"))(mod, mod.exports);
const D = mod.exports;

// ---------- reading a game ----------
const SCHOLAR = `[Event "Test"]\n[White "Rohan"]\n[Black "Meera"]\n[Result "1-0"]\n[Date "2026.11.18"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0`;
const g1 = D.prepare(Chess, SCHOLAR);
assert.equal(g1.moves.length, 7); assert.equal(g1.headers.white, "Rohan"); assert.equal(g1.headers.result, "1-0");
assert.equal(g1.moves[6].san, "Qxf7#"); assert.equal(g1.moves[6].uci, "h5f7"); assert.equal(g1.moves[0].fenBefore.split(" ")[0], "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR");
assert.equal(D.prepare(Chess, "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6").moves.length, 6, "just the moves, no headers, is fine");
assert.equal(D.prepare(Chess, SCHOLAR + "\n\n" + SCHOLAR.replace("Rohan", "Other")).headers.white, "Rohan", "several games pasted: the first is used");
assert.equal(D.prepare(Chess, "hello there, this is not chess").error, "unreadable");
assert.equal(D.prepare(Chess, "").error, "empty");
assert.equal(D.prepare(Chess, "1. e4 e5").error, "short");
assert.equal(D.prepare(Chess, '[Variant "Crazyhouse"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6').error, "variant");
assert.equal(D.prepare(Chess, '[White "<b>x</b>"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6').headers.white, "bx/b", "markup is stripped from names");
assert.equal(D.guessSide(g1.headers, "rohan"), "w"); assert.equal(D.guessSide(g1.headers, "Meera Rao"), null); assert.equal(D.guessSide(g1.headers, "meera"), "b"); assert.equal(D.guessSide(g1.headers, "ab"), null);
// the same game is the same id, a different side is not
assert.equal(D.gameId(g1, "w"), D.gameId(D.prepare(Chess, SCHOLAR.replace('[Event "Test"]', '[Event "Other"]')), "w"));
assert.notEqual(D.gameId(g1, "w"), D.gameId(g1, "b")); assert.match(D.gameId(g1, "w"), /^[0-9a-f]{16}$/);

// ---------- tagging: each case is a position, the move played, and what the engine said ----------
const play = (fen, uci) => { const g = new Chess(fen), mv = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); assert.ok(mv, uci + " is legal in " + fen); return { fenBefore: fen, fenAfter: g.fen(), uci, san: mv.san, to: mv.to, from: mv.from, piece: mv.piece, ply: 1, color: mv.color }; };
const tag = (fen, played, A, B, color = "w") => D.tagMistake(Chess, play(fen, played), color, { mate: null, ...A }, { mate: null, best: "(none)", ...B });

// missed mate in 1 (back rank)
let t = tag("6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1", "g1f1", { best: "d1d8", mate: 1 }, { best: "d8d1" });
assert.deepEqual(t, { id: "mateIn1", kind: "missed", n: 1 });
// ...but if the move still mates, it is not a miss
assert.equal(tag("6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1", "g1f1", { best: "d1d8", mate: 1 }, { best: "x", mate: 2 }), null);
// allowed a mate in 1
t = tag("r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 4 3", "g8f6", { best: "g7g6" }, { best: "h5f7", mate: -1 }, "b");
assert.deepEqual(t, { id: "mateIn1", kind: "allowed", n: 1 });
// hanging piece: Nxe5?? and the knight can just be taken
t = tag("r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3", "f3e5", { best: "f1b5" }, { best: "c6e5" });
assert.equal(t.id, "hangingPiece"); assert.equal(t.kind, "moved"); assert.equal(t.pc, "knight"); assert.equal(t.by, "knight"); assert.equal(t.sq, "e5"); assert.equal(t.defended, false);
// a piece that can be taken but is protected (d4xe5 recaptures) is an even trade, not a hanging piece
t = tag("r1bqkbnr/pppp1ppp/2n5/4p3/3PP3/5N2/PPP2PPP/RNBQKB1R w KQkq - 0 3", "f3e5", { best: "d4e5" }, { best: "c6e5" });
assert.equal(t, null, "a knight taken but recaptured is an even trade, not a hanging piece");
// missed royal fork: Nc7+ forks king and rook
t = tag("r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1", "e1d2", { best: "b5c7" }, { best: "e8d8" });
assert.deepEqual(t, { id: "fork", kind: "missed", pc: "knight", x: "rook", y: "king" });
// missed pin: Bg5 pins the knight on f6 to the queen on e7
t = tag("r1b1kb1r/ppppqppp/2n2n2/4p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 0 6", "e1f1", { best: "c1g5" }, { best: "a7a6" });
assert.equal(t && t.id, "pin"); assert.equal(t.x, "knight"); assert.equal(t.y, "queen");
// missed skewer: Ra8+ then Rxh8
t = tag("4k2r/8/8/8/8/8/8/R3K3 w - - 0 1", "e1d2", { best: "a1a8" }, { best: "e8d7" });
assert.deepEqual(t, { id: "skewer", kind: "missed", pc: "rook", x: "king", y: "rook" });
// a quiet positional slip has no tag
t = tag("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "a2a3", { best: "e2e4" }, { best: "e7e5" });
assert.equal(t, null);

// ---------- the words ----------
let e = D.explain({ san: "Nxe5", best: { san: "Bb5" }, reply: "Nxe5", tag: { id: "hangingPiece", kind: "moved", pc: "knight", sq: "e5", by: "knight", defended: false } }, "Black");
assert.match(e.chip, /^Looks like/); assert.match(e.text, /knight on e5/);
e = D.explain({ san: "Kd2", best: { san: "Nc7+" }, tag: { id: "fork", kind: "missed", pc: "knight", x: "rook", y: "king" } });
assert.match(e.text, /looks like a fork/); assert.match(e.text, /check to the king/);
e = D.explain({ san: "a3", best: { san: "e4" }, tag: null });
assert.equal(e.chip, ""); assert.match(e.text, /better move was e4/); assert.match(e.text, /no puzzle/);
for (const x of [{ id: "pin", x: "knight", y: "queen", pc: "bishop" }, { id: "skewer", x: "king", y: "rook", pc: "rook" }, { id: "mateIn2", kind: "missed", n: 2 }, { id: "mateIn1", kind: "allowed", n: 1 }])
  assert.ok(D.explain({ san: "a3", best: { san: "e4" }, reply: "Qxf7#", tag: x }).text.length > 30);
assert.equal(D.pawns(250), "about 2.5 pawns"); assert.equal(D.pawns(300), "about 3 pawns"); assert.equal(D.pawns(1500), "a huge amount");

// ---------- ranking and keeping, with a pretend engine ----------
// Black is the kid. After each Black move White is better by a scripted amount, so the loss is that amount.
let res = await D.analyse(Chess, g1, "b", async (fen) => {
  const gm = g1.moves.find((m) => m.fenAfter === fen && m.color === "b");
  const win = { e7e5: 0, b8c6: 120, g8f6: 400 }[gm && gm.uci] || 0;     // the kid is Black: White gets better by `win`
  return { best: "a7a6", white: win, mate: null };
});
assert.deepEqual(res.mistakes.map((m) => m.uci), ["g8f6", "b8c6"], "biggest first; a 0-loss move is not a mistake");
assert.equal(res.mistakes[0].loss, 400); assert.equal(res.mistakes[0].no, 3); assert.equal(res.checked, 3);
// "already winning" and "already lost" positions are not flagged
res = await D.analyse(Chess, D.prepare(Chess, "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6"), "w", async (fen) => ({ best: "a1a2", white: fen.includes(" b ") ? 800 : 1000, mate: null }));
assert.equal(res.mistakes.length, 0, "an advantage that stays huge is not a mistake");
// progress and cancel
let seen = []; res = await D.analyse(Chess, g1, "w", async () => ({ best: "a1a2", white: 0, mate: null }), { progress: (i, n) => seen.push(i + "/" + n) });
assert.equal(seen.at(-1), "4/4"); assert.equal(seen[0], "0/4");
assert.equal((await D.analyse(Chess, g1, "w", async () => ({ best: "a1a2", white: 0, mate: null }), { cancel: () => true })).cancelled, true);
// the engine failing stops the analysis with the engine's error
await assert.rejects(D.analyse(Chess, g1, "w", async () => { throw new Error("engine timeout"); }), /engine timeout/);

// ---------- a real analysis with the real engine (skipped if it cannot start here) ----------
async function engine() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-"));
  for (const f of ["stockfish-18-lite-single.js", "stockfish-18-lite-single.wasm"]) fs.copyFileSync("public/stockfish/" + f, path.join(dir, f));
  fs.writeFileSync(path.join(dir, "package.json"), '{"type":"commonjs"}');
  const p = spawn(process.execPath, [path.join(dir, "stockfish-18-lite-single.js")]);
  let buf = "", wait = null;
  p.stdout.on("data", (d) => { buf += d; if (wait && wait.re.test(buf)) { const w = wait; wait = null; w.res(buf); } });
  const until = (re) => new Promise((res, rej) => { if (re.test(buf)) return res(buf); wait = { re, res }; setTimeout(() => rej(new Error("engine timeout")), 30000); });
  p.stdin.write("uci\n"); await until(/uciok/);
  const ask = async (fen, depth = 10) => {
    buf = ""; p.stdin.write(`position fen ${fen}\ngo depth ${depth}\n`); const out = await until(/bestmove/);
    const lines = out.split("\n").filter((l) => l.startsWith("info") && l.includes(" score ") && l.includes(" pv ")), m = lines.at(-1).match(/score (cp|mate) (-?\d+)/), stm = fen.split(" ")[1] === "w" ? 1 : -1;
    const raw = m[1] === "mate" ? (+m[2] > 0 ? 100000 - +m[2] : -100000 - +m[2]) : +m[2];
    return { best: out.match(/bestmove (\S+)/)[1], white: raw * stm, mate: m[1] === "mate" ? +m[2] * stm : null };
  };
  return { ask, close: () => p.kill() };
}
let sf = null; try { sf = await engine(); } catch (err) { console.log("Game doctor: engine could not start here, real-engine checks skipped (" + err.message + ")"); }
if (sf) {
  // Black plays Nf6?? and White mates: the doctor must say "allowed mate in 1"
  let r = await D.analyse(Chess, g1, "b", sf.ask);
  assert.equal(r.mistakes[0].uci, "g8f6"); assert.deepEqual(r.mistakes[0].tag, { id: "mateIn1", kind: "allowed", n: 1 }); assert.equal(r.mistakes[0].reply, "Qxf7#");
  // White has mate in 1 and plays Nf3: the doctor must say "missed mate in 1"
  const g2 = D.prepare(Chess, "1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Nf3 Nxe4");
  r = await D.analyse(Chess, g2, "w", sf.ask);
  const mm = r.mistakes.find((m) => m.uci === "g1f3");
  assert.ok(mm, "Nf3 is flagged"); assert.deepEqual(mm.tag, { id: "mateIn1", kind: "missed", n: 1 }); assert.equal(mm.best.san, "Qxf7#");
  // a piece given away for nothing: 1.e4 e5 2.Nf3 Nc6 3.Nxe5?? Nxe5
  const g3 = D.prepare(Chess, "1. e4 e5 2. Nf3 Nc6 3. Nxe5 Nxe5 4. d4 Nc6 5. d5 Nb8");
  r = await D.analyse(Chess, g3, "w", sf.ask);
  const hp = r.mistakes.find((m) => m.uci === "f3e5");
  assert.ok(hp, "Nxe5 is flagged"); assert.ok(hp.loss >= 150);
  // every saved field is short and plain (what the server stores)
  for (const m of [...r.mistakes]) { assert.match(m.uci, /^[a-h][1-8][a-h][1-8][qrbn]?$/); assert.ok(m.fen.length < 100); assert.ok(m.san.length <= 8); }
  sf.close();
}
console.log("Game doctor checks passed.");
process.exit(0);
