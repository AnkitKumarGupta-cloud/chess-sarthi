// Rebuilds the theme topics in Practice (Pin, Fork, Skewer...) from the vetted ChessMood-style puzzles, easiest first.
//   node tools/moodimport/practice.mjs [--dry]        (needs puzzles.json from convert.mjs; safe to run again)
// A chapter = start position (kid to move) + a goal the app checks with Stockfish after the kid's moves:
//   mate in N, or "win at least X centipawns within N moves". X is set to about 60% of what the best line really wins (min 150),
//   so a good alternative move still counts.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url.replace("tools/moodimport/practice.mjs", "package.json"));
const { Chess } = require("chess.js");

const PER_TOPIC = 12;
const TOPICS = { pin: "9ogFv8Ac", skewer: "tuoBxVE5", fork: "Qj281y1p", discoveredAttack: "MnsJEWnI", doubleCheck: "RUQASaZm", xRayAttack: "lyVYjhPG", deflection: "kdKpaYLW", attraction: "jOZejFWk", clearance: "Grmtwuft",
  counterCheck: "CgjKPvxQ", underpromotion: "49fDW0wP", greekGift: "s5pLU7Of", desperado: "0YcGiH4Y", zwischenzug: "ITWY4GN2" };   // the last five come from OUR OWN generated puzzles (generate.mjs)
const NAME = { pin: "Pin", skewer: "Skewer", fork: "Fork", discoveredAttack: "Discovery", doubleCheck: "Double check", xRayAttack: "X-ray", deflection: "Deflection", attraction: "Attraction", clearance: "Clearance", counterCheck: "Counter check", underpromotion: "Underpromotion", greekGift: "Greek gift", desperado: "Desperado", zwischenzug: "Zwischenzug" };

async function engine() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-"));
  for (const f of ["stockfish-18-lite-single.js", "stockfish-18-lite-single.wasm"]) fs.copyFileSync("public/stockfish/" + f, path.join(dir, f));
  fs.writeFileSync(path.join(dir, "package.json"), '{"type":"commonjs"}');
  const p = spawn(process.execPath, [path.join(dir, "stockfish-18-lite-single.js")]);
  let buf = "", wait = null;
  p.stdout.on("data", (d) => { buf += d; if (wait && wait.re.test(buf)) { const w = wait; wait = null; w.res(buf); } });
  const until = (re) => new Promise((res, rej) => { if (re.test(buf)) return res(buf); wait = { re, res }; setTimeout(() => rej(new Error("engine timeout")), 60000); });
  p.stdin.write("uci\n"); await until(/uciok/);
  const white = async (fen) => { buf = ""; p.stdin.write(`position fen ${fen}\ngo depth 13\n`); const out = await until(/bestmove/);
    const l = out.split("\n").filter((x) => x.includes(" score ")).at(-1).match(/score (cp|mate) (-?\d+)/), s = fen.split(" ")[1] === "w" ? 1 : -1;
    return l[1] === "mate" ? s * (+l[2] > 0 ? 10000 : -10000) : s * +l[2]; };
  return { white, close: () => p.kill() };
}

const dry = process.argv.includes("--dry");
const mood = JSON.parse(fs.readFileSync(new URL("./puzzles.json", import.meta.url), "utf8")).puzzles;
const gf = new URL("./generated.jsonl", import.meta.url);
if (fs.existsSync(gf)) mood.push(...fs.readFileSync(gf, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));   // our own generated puzzles
const pfile = new URL("../../public/practice.json", import.meta.url), practice = JSON.parse(fs.readFileSync(pfile, "utf8"));
const sf = await engine(), taken = new Set(), made = {};

for (const theme of Object.keys(TOPICS)) {
  const pool = mood.filter((p) => !taken.has(p.id) && p.themes.split(" ").includes(theme)).sort((a, b) => a.rating - b.rating);
  const pick = pool.length <= PER_TOPIC ? pool : Array.from({ length: PER_TOPIC }, (_, i) => pool[Math.round(i * (pool.length - 1) / (PER_TOPIC - 1))]);   // spread over the whole difficulty range
  const chapters = [];
  for (const p of pick) {
    taken.add(p.id);
    const g = new Chess(p.fen); g.move({ from: p.moves[0].slice(0, 2), to: p.moves[0].slice(2, 4), promotion: p.moves[0][4] });
    const start = g.fen(), color = g.turn(), n = (p.moves.length - 1 + 1) / 2;       // kid moves = (moves - setup move + 1) / 2
    p.moves.slice(1).forEach((u) => g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }));
    let goal;
    if (g.in_checkmate()) goal = { type: "mate", n };
    else { const w = await sf.white(g.fen()), mine = color === "w" ? w : -w, cp = Math.min(900, Math.max(150, Math.round(mine * 0.6 / 50) * 50)); goal = { type: "eval", cp: color === "w" ? cp : -cp, n }; }
    chapters.push({ name: `${NAME[theme]} #${chapters.length + 1}`, fen: start, goal, line: [], orient: color === "w" ? "white" : "black" });
  }
  made[theme] = chapters;
}
sf.close();
for (const [theme, id] of Object.entries(TOPICS)) {
  const t = practice.topics.find((x) => x.id === id);
  if (!t || made[theme].length < 5) { console.log("skipped", theme, made[theme].length); continue; }
  t.chapters = made[theme]; t.v = 2;                       // v bumps the save key, so old "done" ticks do not land on new puzzles
  console.log(theme, "->", t.title, made[theme].length, "chapters, ratings climb");
}
if (!/ChessMood/.test(practice.source)) practice.source += " Theme topics (pin, fork, skewer, discovery, double check, x-ray, deflection, attraction, clearance) use ChessMood-style puzzles used with permission.";
if (!dry) fs.writeFileSync(pfile, JSON.stringify(practice));
