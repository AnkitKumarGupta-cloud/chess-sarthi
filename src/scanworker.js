// Runs the board reader away from the page, so the class video doesn't freeze while it works.
import { readPosition, parseModel } from "./boardscan.js";

let model = null;
self.onmessage = async (e) => {
  try {
    if (!model) {
      const r = await fetch("/scan/pieces.bin");
      if (!r.ok) throw new Error("Couldn't load the board reader. Check your internet.");
      model = parseModel(await r.arrayBuffer());
    }
    const res = readPosition(e.data, model);
    self.postMessage(res ? { ok: true, ...res } : { ok: false });
  } catch (err) {
    self.postMessage({ error: String((err && err.message) || err) });
  }
};
