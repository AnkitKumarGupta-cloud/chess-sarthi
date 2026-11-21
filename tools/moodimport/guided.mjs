// Guided Practice chapters (a fixed line, the app only accepts THE line) that end in checkmate become goal chapters:
// "Checkmate in N moves". Then any move that still mates in time is accepted, and the computer answers with Stockfish.
//   node tools/moodimport/guided.mjs        (safe to run again)
// Only chapters where the kid moves first and the kid gives the final mate are changed; other guided lessons keep their fixed line.
import fs from "node:fs";
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
fs.writeFileSync(file, JSON.stringify(data));
console.log("turned into 'checkmate in N' goals:", changed, "| still fixed lines:", kept);
