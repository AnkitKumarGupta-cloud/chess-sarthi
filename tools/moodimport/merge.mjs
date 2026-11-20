// Puts the checked ChessMood puzzles (puzzles.json) into public/levels.json, "mixed into the levels".
//   node tools/moodimport/merge.mjs [--per-level 6] [--dry]
// Safe to run again: old ChessMood puzzles (ids starting "cm") are removed first, then re-added.
// Each puzzle goes to the level whose average rating is closest, at the END of that level, so the position
// of every existing puzzle stays the same (saved progress and "missed puzzle" lists keep pointing to the right puzzle).
import fs from "node:fs";
const args = process.argv.slice(2), dry = args.includes("--dry");
const perLevel = +(args[args.indexOf("--per-level") + 1] || 6) || 6;
const file = new URL("../../public/levels.json", import.meta.url);
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const mood = JSON.parse(fs.readFileSync(new URL("./puzzles.json", import.meta.url), "utf8")).puzzles;

data.levels = data.levels.map((l) => l.filter((p) => !String(p[0]).startsWith("cm")));
const avg = data.levels.map((l) => l.reduce((a, p) => a + p[3], 0) / l.length);
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const added = data.levels.map(() => 0);
let used = 0;
for (const p of [...mood].sort((a, b) => hash(a.id) - hash(b.id))) {              // fixed shuffle, so every theme is mixed
  const order = avg.map((a, i) => [Math.abs(a - p.rating), i]).sort((a, b) => a[0] - b[0]);
  const hit = order.find(([d, i]) => d <= 120 && added[i] < perLevel);              // closest level that still has room (within 120 rating points)
  if (!hit) continue;
  const i = hit[1]; added[i]++; used++;
  data.levels[i].push([p.id, p.fen, p.moves.join(" "), p.rating, p.themes]);
}
if (!/ChessMood/.test(data.source)) data.source += " + ChessMood (used with permission)";
console.log(`${used} of ${mood.length} ChessMood puzzles placed (max ${perLevel} per level), levels with extras: ${added.filter(Boolean).length}`);
if (!dry) fs.writeFileSync(file, JSON.stringify(data));
