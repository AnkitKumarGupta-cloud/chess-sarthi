// Guided Practice chapters (a fixed line, the app only accepts THE line) that end in checkmate become goal chapters:
// "Checkmate in N moves". Then any move that still mates in time is accepted, and the computer answers with Stockfish.
//   node tools/moodimport/guided.mjs        (safe to run again)
// Only chapters where the kid moves first and the kid gives the final mate are changed; other guided lessons keep their fixed line.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url.replace("tools/moodimport/guided.mjs", "package.json"));
const { Chess } = require("chess.js");
const file = new URL("../../public/practice.json", import.meta.url), data = JSON.parse(fs.readFileSync(file, "utf8"));
let changed = 0, kept = 0;
for (const t of data.topics) for (const c of t.chapters) {
  if (c.goal || !c.line || !c.line.length) continue;
  const kid = c.orient === "black" ? "b" : "w", g = new Chess(c.fen);
  if (!g.fen() || g.turn() !== kid) { kept++; continue; }
  let n = 0, ok = true;
  for (const u of c.line) { const mover = g.turn(); const m = g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); if (!m) { ok = false; break; } if (mover === kid) n++; }
  if (!ok || !g.in_checkmate() || g.turn() === kid) { kept++; continue; }       // not a mate delivered by the kid
  // technique lessons (5+ moves, e.g. two-rook mate) may be done a little slower than the lesson line: 4 extra moves allowed; short mates stay exact
  c.goal = { type: "mate", n: n >= 5 ? n + 4 : n }; changed++;
}

// ---- stage 2: the other guided lessons (endgame technique). The goal comes from what the lesson line really reaches, judged by Stockfish. ----
async function engine() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-"));
  for (const f of ["stockfish-18-lite-single.js", "stockfish-18-lite-single.wasm"]) fs.copyFileSync("public/stockfish/" + f, path.join(dir, f));
  fs.writeFileSync(path.join(dir, "package.json"), '{"type":"commonjs"}');
  const p = spawn(process.execPath, [path.join(dir, "stockfish-18-lite-single.js")]);
  let buf = "", wait = null;
  p.stdout.on("data", (d) => { buf += d; if (wait && wait.re.test(buf)) { const w = wait; wait = null; w.res(buf); } });
  const until = (re) => new Promise((res, rej) => { if (re.test(buf)) return res(buf); wait = { re, res }; setTimeout(() => rej(new Error("engine timeout")), 60000); });
  p.stdin.write("uci\n"); await until(/uciok/);
  const white = async (fen) => { buf = ""; p.stdin.write(`position fen ${fen}\ngo depth 16\n`); const out = await until(/bestmove/);
    const l = out.split("\n").filter((x) => x.includes(" score ")).at(-1).match(/score (cp|mate) (-?\d+)/), sg = fen.split(" ")[1] === "w" ? 1 : -1;
    return l[1] === "mate" ? sg * (+l[2] > 0 ? 10000 : -10000) : sg * +l[2]; };
  return { white, close: () => p.kill() };
}
const sf = await engine();
let eased = 0, left = 0;
for (const t of data.topics) for (const c of t.chapters) {
  if (c.goal || !c.line || !c.line.length) continue;
  const kid = c.orient === "black" ? "b" : "w", g = new Chess(c.fen);
  if (!g.fen() || g.turn() !== kid) { left++; continue; }                      // the computer moves first: keeps its fixed line
  const total = c.line.filter((_, i) => i % 2 === 0).length;                   // kid moves in the line
  if (total < 2 || total > 40 || /introduction|failure/i.test(c.name)) { left++; continue; }   // intros and "how NOT to" lessons keep their fixed line
  const n = Math.min(total, 12); let k = 0;
  for (const u of c.line) { const m = g.turn(); g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); if (m === kid && ++k === n) break; }
  const w = await sf.white(g.fen()), mine = kid === "w" ? w : -w;
  if (g.in_checkmate()) { c.goal = { type: "mate", n }; }
  else if (Math.abs(mine) < 120) c.goal = { type: "draw", n };                  // a drawing lesson: hold the draw
  else if (mine >= 120) { const cp = Math.min(900, Math.max(150, Math.round(mine * 0.6 / 50) * 50)); c.goal = { type: "eval", cp: kid === "w" ? cp : -cp, n }; }
  else { left++; continue; }                                                     // the lesson line loses ground: not safe to turn into a goal
  eased++;
}
sf.close();
console.log("stage 2: guided lessons turned into goals:", eased, "| still fixed lines:", left);
fs.writeFileSync(file, JSON.stringify(data));
console.log("turned into 'checkmate in N' goals:", changed, "| still fixed lines:", kept);
