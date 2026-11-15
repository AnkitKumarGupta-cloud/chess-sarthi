// Score-sheet reader: talking to the hosted model, photo checks, and saving the draft.
// The model is called straight from the user's device (never through our server): its free
// GPU quota is counted per IP address, so each phone gets its own.
import { ReaderError, classify, resultFromSSE, MAX_PHOTOS } from "./logic.js";

export const BASE = "https://sanskar12301-chess-reader.hf.space";
const TIMEOUT_MS = 120000;

// The three calls: upload the photo, start the job, read the result stream.
export async function readSheet(blob, { page = 1, onStage = () => {}, base = BASE, timeoutMs = TIMEOUT_MS } = {}) {
  const ctl = new AbortController(); let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, timeoutMs);
  const call = async (url, opts) => {
    let res; try { res = await fetch(url, { ...opts, signal: ctl.signal }); } catch (e) { throw new ReaderError(timedOut ? "timeout" : "network"); }
    if (!res.ok) { let t = ""; try { t = (await res.text()).slice(0, 300); } catch {} throw classify(/quota|zerogpu|gpu|too many|rate/i.test(t) ? t : "", res.status); }
    return res;
  };
  const body = async (res, json) => { try { return json ? await res.json() : await res.text(); } catch (e) { if (timedOut) throw new ReaderError("timeout"); if (json) throw new ReaderError("bad"); throw new ReaderError("network"); } };
  try {
    onStage("Uploading…");
    const form = new FormData(); form.append("files", blob, "sheet.jpg");
    const up = await body(await call(base + "/gradio_api/upload", { method: "POST", body: form }), true);
    const path = Array.isArray(up) && typeof up[0] === "string" ? up[0] : null;
    if (!path) throw new ReaderError("bad");
    onStage("Waiting for the reader…");
    const job = await body(await call(base + "/gradio_api/call/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: [{ path, meta: { _type: "gradio.FileData" } }] }) }), true);
    const id = job && typeof job.event_id === "string" && /^[\w-]{1,80}$/.test(job.event_id) ? job.event_id : null;
    if (!id) throw new ReaderError("bad");
    onStage("Reading the sheet…");
    return resultFromSSE(await body(await call(base + "/gradio_api/call/read/" + id, {}), false), page);
  } finally { clearTimeout(timer); }
}

/* ---------- photos ---------- */
const isPhoto = (b) => (b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) || (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50);
export class PhotoError extends Error {}
export function checkCount(n) { if (n > MAX_PHOTOS) throw new PhotoError(`You picked ${n} photos. Choose up to ${MAX_PHOTOS} (one per page) — each photo uses a scan.`); }
// Makes sure the file really is a JPG/PNG/WebP the device can open, then returns the two sizes we need.
export async function preparePhoto(file) {
  const bad = () => new PhotoError(`“${String(file && file.name || "This file").slice(0, 60)}” isn't a photo the app can open. Use a JPG or PNG photo of the sheet (on an iPhone, a screenshot of the photo works).`);
  if (!file || !file.size) throw bad();
  let head; try { head = new Uint8Array(await file.slice(0, 12).arrayBuffer()); } catch { throw bad(); }
  if (!isPhoto(head)) throw bad();
  let bmp; try { bmp = await createImageBitmap(file); } catch { throw bad(); }
  if (!bmp.width || !bmp.height) throw bad();
  const scaled = (max, q) => new Promise((ok, no) => {
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height)), c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0, c.width, c.height);
    c.toBlob((b) => (b ? ok(b) : no(bad())), "image/jpeg", q);
  });
  const upload = await scaled(1500, 0.85), view = await scaled(2400, 0.88);
  if (bmp.close) bmp.close();
  return { upload, view };
}

/* ---------- draft: the session in localStorage, the photos in IndexedDB ---------- */
const KEY = "cs-reader.draft", GAMES = "cs-reader.games";
const db = () => new Promise((ok, no) => { const r = indexedDB.open("cs-reader", 1); r.onupgradeneeded = () => r.result.createObjectStore("photos"); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
const tx = async (mode, fn) => { const d = await db(); return new Promise((ok, no) => { const t = d.transaction("photos", mode), q = fn(t.objectStore("photos")); t.oncomplete = () => { d.close(); ok(q && q.result); }; t.onerror = t.onabort = () => { d.close(); no(t.error); }; }); };
export const draft = {
  save(session) { try { localStorage.setItem(KEY, JSON.stringify(session)); } catch {} },
  load() { try { const s = JSON.parse(localStorage.getItem(KEY)); return s && Array.isArray(s.moves) && s.moves.length ? s : null; } catch { return null; } },
  async clear() { try { localStorage.removeItem(KEY); } catch {} try { await tx("readwrite", (s) => s.clear()); } catch {} },
  async putPhoto(page, blob) { try { await tx("readwrite", (s) => s.put(blob, page)); } catch {} },
  async photo(page) { try { return (await tx("readonly", (s) => s.get(page))) || null; } catch { return null; } },
};
export const games = {
  list() { try { const g = JSON.parse(localStorage.getItem(GAMES)); return Array.isArray(g) ? g : []; } catch { return []; } },
  add(g) { const all = [g, ...games.list()].slice(0, 50); try { localStorage.setItem(GAMES, JSON.stringify(all)); } catch {} },
  remove(id) { try { localStorage.setItem(GAMES, JSON.stringify(games.list().filter((g) => g.id !== id))); } catch {} },
};
