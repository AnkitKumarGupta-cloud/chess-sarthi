// node run.mjs shots/truth.json model.bin  -> accuracy of the full pipeline on screenshots
import fs from "node:fs";
import { readPosition, placement, parseModel } from "../../src/boardscan.js";
const truth = JSON.parse(fs.readFileSync(process.argv[2]));
const buf = fs.readFileSync(process.argv[3]); const model = parseModel(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
const exp = (fen) => fen.split("/").map((r) => r.replace(/\d/g, (d) => ".".repeat(+d))).join("");
let sq = 0, ok = 0, boards = 0, perfect = 0, fl = 0;
for (const t of truth) {
  const raw = fs.readFileSync(t.file.replace(".png", ".raw")); const [w, h] = fs.readFileSync(t.file.replace(".png", ".dim"), "utf8").split(" ").map(Number);
  const t0 = Date.now(); const r = readPosition({ data: raw, width: w, height: h }, model); const ms = Date.now() - t0;
  if (!r) { console.log(t.file, "NO BOARD", ms + "ms"); continue; }
  boards++;
  const got = exp(placement(r.screen, t.flip)), want = exp(t.fen);
  let c = 0; for (let i = 0; i < 64; i++) if (got[i] === want[i]) c++;
  sq += 64; ok += c; if (c === 64) perfect++; if (r.flipped === t.flip) fl++;
  console.log(t.file.split("/").pop(), t.set, t.size, `box ${r.box.x.toFixed(1)},${r.box.y.toFixed(1)} ${r.box.size.toFixed(1)}`, `${c}/64`, r.flipped === t.flip ? "" : "FLIP-WRONG", ms + "ms", c < 64 ? got + " vs " + want : "");
}
console.log(`boards found ${boards}/${truth.length}, squares ${ok}/${sq} (${(100 * ok / sq).toFixed(2)}%), perfect ${perfect}, orientation ok ${fl}`);
