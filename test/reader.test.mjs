// Unit tests for the score-sheet reader's pure logic.  Run: node test/reader.test.mjs
import assert from "node:assert/strict"; import fs from "node:fs"; import { createRequire } from "node:module";
globalThis.Chess = createRequire(import.meta.url)("chess.js").Chess;
const L = await import("../public/reader/logic.js");
const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/reader-result.json", import.meta.url)));
const fresh = () => L.newSession(L.normaliseResult(structuredClone(fixture)));
const mk = (list, conf = 0.99) => L.newSession(L.normaliseResult({ moves: list.map((w, i) => ({ move: (i >> 1) + 1, colour: i % 2 ? "b" : "w", written: w, confidence: conf })) }));

// fixCase
for (const [a, b] of [["nf3", "Nf3"], ["kxe2", "Kxe2"], ["rfd1", "Rfd1"], ["qh5", "Qh5"], ["o-o", "O-O"], ["0-0-0", "O-O-O"], ["e8q", "e8Q"], ["b4", "b4"], ["bxc3", "bxc3"], ["F3", "f3"], ["KF4", "Kf4"], ["KF2", "Kf2"], ["F6", "f6"], ["RD1", "Rd1"], ["NXF7", "Nxf7"], ["Exd5", "exd5"], ["EXD5", "exd5"], ["Bxc3", "Bxc3"], ["Bc4", "Bc4"], ["B1d3", "B1d3"], ["B4", "b4"], ["E8Q", "e8Q"], ["Nbd7", "Nbd7"], ["R1a3", "R1a3"], ["O-O-O", "O-O-O"], [" 0-0 ", "O-O"], ["e8=n", "e8=N"]]) assert.equal(L.fixCase(a), b, a);
// moveKey
assert.equal(L.moveKey("Nxe4+"), L.moveKey("Ne4")); assert.equal(L.moveKey("exd5"), L.moveKey("ed5")); assert.equal(L.moveKey("e8=Q"), L.moveKey("e8Q"));
assert.equal(L.moveKey("0-0"), "O-O"); assert.equal(L.moveKey("exd6 e.p."), "ed6"); assert.notEqual(L.moveKey("bxc3"), L.moveKey("Bxc3"));

// recheck: legal game, illegal move, fixing it, missing ply
{ const s = mk(["E4", "e5", "NF3", "Nc6", "Bb5", "A6", "Ba4", "NF6", "0-0", "Be7", "Re1", "B5"]); assert.ok(s.moves.every((m) => m.check === "ok"), "capital-letter slips are legal"); assert.equal(s.moves[0].written, "E4"); assert.equal(s.moves[0].san, "e4"); assert.equal(s.moves[11].san, "b5"); assert.ok(L.toPGN(s).includes("1. e4 e5 2. Nf3")); }
// 0.70 puts a move in the queue; 0.70-0.90 only marks it
{ const s = mk(["e4", "e5", "Nf3"], 0.8); assert.equal(L.reviewReason(s.moves[0]), null); assert.ok(L.isUnsure(s.moves[0])); assert.deepEqual(L.reviewList(s), []); assert.equal(L.summary(s).unsure, 3); assert.equal(L.summary(s).pending, 0); assert.equal(L.summary(s).complete, true);
  const t = mk(["e4", "e5"], 0.69); assert.equal(L.reviewReason(t.moves[0]), "Low confidence"); L.acceptAsWritten(t, 0); assert.ok(!L.isUnsure(t.moves[0])); assert.equal(L.LOW_CONF, 0.7); assert.equal(L.NOTE_CONF, 0.9); }
{ const s = mk(["e4", "e5", "nf3", "Nc6", "Bb5", "a6"]); assert.ok(s.moves.every((m) => m.check === "ok")); assert.equal(s.moves[2].san, "Nf3"); assert.equal(s.moves[2].written, "nf3"); }
{ const s = fresh(); const sum = L.summary(s);
  assert.deepEqual([sum.total, sum.legal, sum.illegal, sum.unchecked, sum.unsure, sum.playable], [60, 26, 1, 33, 6, 26]);
  assert.equal(s.moves[26].check, "illegal"); assert.ok(s.moves.slice(27).every((m) => m.check === "unchecked" && m.fenBefore === null)); assert.ok(s.moves[26].fenBefore);
  assert.equal(L.currentIndex(s), L.reviewList(s)[0]); assert.deepEqual(L.reviewList(s), [11, 22, 26, 33, 40]); assert.equal(L.reviewReason(s.moves[26]), "Cannot be played in this position");
  L.setPlayed(s, 26, "Rfd1");
  const after = L.summary(s); assert.equal(after.legal, 33); assert.equal(s.moves[26].written, "Qf4"); assert.equal(s.moves[26].played, "Rfd1"); assert.equal(s.moves[26].san, "Rfd1"); assert.equal(s.moves[33].check, "illegal");
  const pgn = L.toPGN(s, { date: "2026.11.15" });
  assert.ok(pgn.includes("Rfd1 {written: Qf4}")); assert.ok(pgn.includes(`[Annotator "Score sheet reader: move 17... 'ef4' cannot be played"]`)); assert.ok(!pgn.includes("gxf3")); assert.ok(pgn.includes('[Date "2026.11.15"]')); assert.ok(pgn.trim().endsWith("*"));
  L.setPlayed(s, 33, "exf3"); assert.ok(L.summary(s).complete === false);           // 6 low-confidence moves still to look at
  assert.equal(L.summary(s).legal, 60);
  L.resetMove(s, 26); assert.equal(L.summary(s).legal, 26); assert.equal(s.moves[26].played, null); assert.equal(s.moves[26].confirmed, false); }
{ const s = mk(["e4", "e5", "Nf3"]); s.moves.splice(1, 1); L.recheck(s); assert.deepEqual(s.moves.map((m) => m.check), ["ok", "unchecked"]); }   // black's move missing

// review rules
{ const s = mk(["e4", "e5", "Qh7"], 0.5); assert.equal(L.reviewReason(s.moves[0]), "Low confidence"); assert.equal(L.reviewReason(s.moves[2]), "Cannot be played in this position");
  L.acceptAsWritten(s, 0); assert.equal(L.reviewReason(s.moves[0]), null);
  L.setPlayed(s, 2, "Qz9"); assert.equal(L.reviewReason(s.moves[2]), "Still not a legal move here");
  L.acceptAsWritten(s, 2); assert.equal(L.reviewReason(s.moves[2]), null); assert.equal(s.moves[2].check, "illegal"); assert.deepEqual(L.reviewList(s), [1]);
  L.setPlayed(s, 1, "e5"); assert.equal(s.moves[1].played, null); assert.equal(s.moves[1].confirmed, true); assert.deepEqual(L.decisions(s), [0, 1, 2]);
  s.focus = 0; assert.equal(L.currentIndex(s), 0); s.focus = null; assert.equal(L.currentIndex(s), null); }
// suspects: 1...Nf6 misread as 1...d5 makes a later ...d5 impossible
{ const s = mk(["d4", "d5", "c4", "e6", "Nc3", "d5"]); assert.equal(s.moves[5].check, "illegal"); assert.deepEqual(L.suspects(s, 5), [1]); assert.deepEqual(L.suspects(s, 1), []); }

// addPage: confidence wins unless the human confirmed
{ const s = mk(["e4", "e5", "Nf3"], 0.6); L.setPlayed(s, 0, "e4");
  const p2 = L.normaliseResult({ white: "W", moves: [{ move: 1, colour: "w", written: "d4", confidence: 0.99 }, { move: 1, colour: "b", written: "c5", confidence: 0.99 }, { move: 2, colour: "w", written: "Nf3", confidence: 0.2 }, { move: 2, colour: "b", written: "d6", confidence: 0.95 }] });
  const r = L.addPage(s, p2); assert.equal(r.dupes, 3); assert.ok(r.message.startsWith("3 moves appeared on two pages"));
  assert.deepEqual(s.moves.map((m) => m.written), ["e4", "c5", "Nf3", "d6"]); assert.equal(s.moves[2].confidence, 0.6); assert.equal(s.moves[3].page, 2); assert.equal(s.pages, 2); assert.equal(s.white, "W"); assert.ok(s.moves.every((m) => m.check === "ok")); }

// PGN header cleaning
{ const s = mk(["e4"]); s.white = 'A "B"\nC\\'; s.tournament = ""; const p = L.toPGN(s, { result: "1-0", date: "2026.01.02" }); assert.ok(p.includes(`[White "A 'B' C"]`)); assert.ok(p.includes('[Event "?"]')); assert.ok(p.includes("1. e4 1-0")); assert.ok(!p.includes("Annotator"));
  assert.equal(L.pgnFileName({ white: "Aarav S", black: "Rohan K" }), "Aarav-S_vs_Rohan-K.pgn"); assert.equal(L.pgnFileName({ white: "<>", black: "" }), "score-sheet.pgn"); }

// SSE + results + errors
{ const sse = (ev, d) => `event: generating\ndata: null\n\nevent: ${ev}\ndata: ${d}\n\n`;
  assert.deepEqual(L.parseSSE("data: a\ndata: b\n\nevent: x\ndata: 1\n"), [{ event: "message", data: "a\nb" }, { event: "x", data: "1" }]);
  assert.equal(L.resultFromSSE(sse("complete", JSON.stringify([fixture]))).moves.length, 60);
  assert.equal(L.resultFromSSE(sse("complete", JSON.stringify([JSON.stringify(fixture)]))).white, "Aarav S");          // array of string
  const fail = (body) => { try { L.resultFromSSE(body); } catch (e) { return e; } assert.fail("should throw"); };
  const nul = fail(sse("error", "null")); assert.equal(nul.code, "server"); assert.ok(!L.QUOTA_RE.test(nul.message), nul.message); assert.ok(nul.message.includes("free daily limit"));
  for (const t of ["You have exceeded your GPU quota", "ZeroGPU limit reached", "Too Many Requests", "rate limit hit", "GPU time used"]) assert.equal(fail(sse("error", JSON.stringify(t))).code, "quota", t);
  assert.equal(fail(sse("error", JSON.stringify("CUDA out of memory"))).code, "server"); assert.ok(fail(sse("error", JSON.stringify("CUDA out of memory"))).message.includes("CUDA out of memory"));
  assert.equal(fail("garbage").code, "bad"); assert.equal(fail(sse("complete", "{not json")).code, "bad"); assert.equal(fail(sse("complete", "[null]")).code, "bad"); assert.equal(fail(sse("complete", JSON.stringify([{ moves: "x" }]))).code, "bad");
  assert.equal(fail(sse("complete", JSON.stringify([{ moves: [] }]))).code, "empty");
  assert.equal(L.classify("", 429).code, "quota"); assert.equal(L.classify("boom", 500).code, "server"); }
// hostile / broken results never crash
{ const r = L.normaliseResult({ tournament: 5, white: { a: 1 }, black: '"><img src=x onerror=alert(1)>', raw_text: null,
    moves: [null, 3, "x", { move: "1", colour: "w", written: "e4" }, { move: 1, colour: "w", written: "<b>e4</b>", confidence: "high", suggestions: "no" }, { move: 1, colour: "z", written: "e5" }, { move: 1, colour: "b", written: "", confidence: 2 }, { move: 1.5, colour: "b", written: "e5" }, { move: 1, colour: "b", written: "e5", confidence: 0.5, suggestions: ["a", 1, "b", "c", "d"] }] });
  assert.equal(r.tournament, "5"); assert.equal(r.white, ""); assert.equal(r.moves.length, 2); assert.equal(r.moves[0].confidence, null); assert.deepEqual(r.moves[1].suggestions, ["a", "1", "b"]);
  const big = L.normaliseResult({ moves: Array.from({ length: 2000 }, (_, i) => ({ move: (i >> 1) + 1, colour: i % 2 ? "b" : "w", written: "e4" })) }); assert.ok(big.moves.length <= L.MAX_MOVES);
  assert.equal(L.normaliseResult(null), null); assert.equal(L.normaliseResult("[]"), null); assert.equal(L.normaliseResult({}), null);
  const s = L.newSession(r); assert.equal(s.moves[0].check, "ok"); L.toPGN(s);
  const x = L.newSession(L.normaliseResult({ moves: [{ move: 1, colour: "w", written: "<img src=x onerror=alert(1)>" }] })); assert.equal(x.moves[0].check, "illegal"); assert.ok(x.moves[0].written.length <= 16);
  assert.ok(!L.toPGN(x).includes("\n<")); }
// manual entry
{ const s = L.newSession(L.normaliseResult(L.movesFromText("1. d4 Nf6 2. c4 {good} e6 1-0"))); assert.deepEqual(s.moves.map((m) => m.san), ["d4", "Nf6", "c4", "e6"]); }

// predictView
{ const P = (anchors, colour, move, page = 1) => L.predictView(anchors, { page, colour, move }), A = (colour, move, x, y, page = 1) => ({ page, colour, move, x, y });
  assert.equal(P([], "w", 5), null);
  assert.deepEqual(P([A("w", 5, 0.2, 0.3)], "w", 5), { x: 0.2, y: 0.3 });                                   // exact
  const mid = P([A("w", 4, 0.2, 0.2), A("w", 8, 0.2, 0.4)], "w", 6); assert.ok(Math.abs(mid.y - 0.3) < 1e-9 && Math.abs(mid.x - 0.2) < 1e-9);   // interpolate
  const down = P([A("w", 4, 0.2, 0.2), A("w", 6, 0.2, 0.3)], "w", 9); assert.ok(Math.abs(down.y - 0.45) < 1e-9 && down.x === 0.2);            // extrapolate down a column
  const row = P([A("w", 7, 0.2, 0.5)], "b", 7); assert.deepEqual(row, { x: null, y: 0.5 });                    // other colour, same row: y only
  assert.equal(P([A("w", 20, 0.2, 0.9), A("w", 21, 0.6, 0.1)], "w", 23), null);                              // new column: y goes back up, no pitch
  assert.equal(P([A("w", 4, 0.2, 0.8), A("w", 6, 0.2, 0.9)], "w", 12), null);                                // off the photo
  assert.equal(P([A("w", 1, 0.2, 0.1), A("w", 2, 0.2, 0.15)], "w", 40), null);                               // too far
  assert.equal(P([A("w", 5, 0.2, 0.3, 2)], "w", 5), null); }                                                 // other page
console.log("Reader logic checks passed.");
