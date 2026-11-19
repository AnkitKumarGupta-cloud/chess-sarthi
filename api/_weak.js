// Pure logic for the weakness tracker (no database, no network), so it is easy to test.
// An attempt is saved as a compact array:  [k, puzzleId, "theme theme", ok(1|0), seconds, timestampMs, "YYYY-MM-DD", c?]
//   k  = unique id made by the phone, so the same attempt is never counted twice
//   ok = 1 when the puzzle was solved with no wrong move and without opening the solution (a hint is allowed: the child still found it).
//   c  = (optional, Phase 4) 1 when the child did the "Think first" checklist before moving, 0 when they did not.
//        Only sent once the child has tried Think first; older attempts have no c and are left out of the comparison.
//        A wrong first move is a FAILED attempt even if the second try works: the position was not understood the first time.

export const MAX_ATTEMPTS = 1200;   // newest kept; older ones are dropped
export const MIN_TRIES = 4;         // a theme needs this many tries before it can be called weak
export const WEAK_RATE = 0.4;       // ...and this share of failures

// Lichess tags that describe the position, not an idea a kid can learn.
const GENERIC = new Set(["short", "long", "veryLong", "oneMove", "middlegame", "endgame", "opening", "advantage", "crushing", "equality", "master", "masterVsMaster", "superGM", "mate"]);

const num = (v, max) => (Number.isFinite(+v) ? Math.max(0, Math.min(max, Math.round(+v))) : 0);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function cleanThemes(s) {
  const seen = new Set();
  for (const t of String(s || "").split(/\s+/)) {
    if (/^[A-Za-z0-9]{2,32}$/.test(t) && !GENERIC.has(t)) seen.add(t);
    if (seen.size >= 6) break;
  }
  return [...seen];
}

// Returns a clean attempt array, or null if it is not usable.
export function cleanAttempt(a, now = Date.now()) {
  if (!a || typeof a !== "object") return null;
  const k = String(a.k || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 24), id = String(a.id || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 10);
  if (!k || !id) return null;
  const th = cleanThemes(a.th);
  if (!th.length) return null; // an attempt with no theme cannot say what the kid is weak at
  let t = +a.t; if (!Number.isFinite(t) || t > now + 864e5 || t < now - 400 * 864e5) t = now;
  const d = DAY.test(a.d) ? a.d : new Date(t).toISOString().slice(0, 10);
  const row = [k, id, th.join(" "), a.ok ? 1 : 0, num(a.s, 3600), Math.round(t), d];
  if (a.c === 1 || a.c === 0) row.push(a.c);   // only attempts made with Sathi Check on carry a 1 or 0
  return row;
}

// Adds new attempts to a stored record. Returns how many were new.
export function addAttempts(rec, incoming, now = Date.now()) {
  const have = new Set(rec.list.map((x) => x[0]));
  let n = 0;
  for (const a of incoming) {
    const c = cleanAttempt(a, now);
    if (!c || have.has(c[0])) continue;
    have.add(c[0]); rec.list.push(c); n++;
  }
  rec.list.sort((a, b) => a[5] - b[5]);
  if (rec.list.length > MAX_ATTEMPTS) rec.list = rec.list.slice(-MAX_ATTEMPTS);
  return n;
}

// Phase 4: does thinking first help? Looks at the newest 30 attempts that know (c is 1 or 0).
// Each side needs 3 attempts before its rate is shown, so one lucky puzzle never makes a claim.
export function thinkFirstStats(list) {
  const rows = list.filter((a) => a[7] === 0 || a[7] === 1).slice(-30);
  if (rows.length < 5) return null;
  const rate = (r) => (r.length >= 3 ? Math.round((r.filter((a) => a[3]).length / r.length) * 100) : null);
  const w = rows.filter((a) => a[7] === 1), wo = rows.filter((a) => a[7] === 0);
  return { of: rows.length, with: w.length, withRate: rate(w), withoutRate: rate(wo) };
}

export const emptyRecord = () => ({ v: 1, seed: {}, list: [] });
export function parseRecord(s) {
  try {
    const r = s ? JSON.parse(s) : null;
    if (r && Array.isArray(r.list)) return { v: 1, seed: r.seed && typeof r.seed === "object" ? r.seed : {}, list: r.list };
  } catch { /* fall through */ }
  return emptyRecord();
}

const dayNum = (d) => Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5);
const dayStr = (n) => new Date(n * 864e5).toISOString().slice(0, 10);

// Everything the screens need, worked out from the stored record.
//   themes: every theme with tries/fails   weak: the weakest few (high failure rate, enough tries)
//   streak: days in a row with at least one puzzle (today may still be empty)   week: last 7 days, oldest first
export function weakStats(rec, today) {
  const t0 = DAY.test(today) ? today : new Date().toISOString().slice(0, 10);
  const by = {};
  const bump = (th, tries, fails) => { const x = (by[th] = by[th] || [0, 0]); x[0] += tries; x[1] += fails; };
  for (const [th, v] of Object.entries(rec.seed || {})) if (Array.isArray(v) && /^[A-Za-z0-9]{2,32}$/.test(th) && !GENERIC.has(th)) bump(th, num(v[0], 99999), Math.min(num(v[0], 99999), num(v[1], 99999)));
  for (const a of rec.list) for (const th of String(a[2]).split(" ")) bump(th, 1, a[3] ? 0 : 1);
  const themes = Object.entries(by).map(([id, [tries, fails]]) => ({ id, tries, fails, rate: tries ? fails / tries : 0 })).sort((a, b) => b.tries - a.tries);
  const weak = themes.filter((x) => x.tries >= MIN_TRIES && x.rate >= WEAK_RATE).sort((a, b) => b.rate - a.rate || b.tries - a.tries).slice(0, 5);
  const days = new Set(rec.list.map((a) => a[6]));
  let n = dayNum(t0), streak = 0;
  if (!days.has(dayStr(n))) n--;               // today may not be played yet: do not break the streak
  while (days.has(dayStr(n))) { streak++; n--; }
  const week = Array.from({ length: 7 }, (_, i) => { const d = dayStr(dayNum(t0) - 6 + i); return { d, n: rec.list.filter((a) => a[6] === d).length }; });
  const last = rec.list.slice(-30), clean = last.filter((a) => a[3]).length;
  return {
    total: rec.list.length + Object.values(rec.seed || {}).reduce((s, v) => s + (Array.isArray(v) ? num(v[0], 99999) : 0), 0),
    themes, weak, streak, week, daysTotal: days.size,
    thinkFirst: thinkFirstStats(rec.list),
    firstTryRate: last.length >= 5 ? Math.round((clean / last.length) * 100) : null,
    recent: rec.list.slice(-8).reverse().map((a) => ({ id: a[1], themes: a[2].split(" "), ok: !!a[3], secs: a[4], at: a[5] })),
  };
}
