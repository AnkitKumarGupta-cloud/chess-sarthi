import { handler, HttpError, whoIs, kv, kvPipe, listUsers } from "./_lib.js";

// Student progress, saved so the teacher can see it and so it follows the student to any device.
//  POST  (student)  { state, summary }  -> saves both
//  GET   (student)                      -> { progress: { state, at } | null }   (to restore on a new device)
//  GET   (teacher)                      -> { students: [{ username, name, batch, batchName, summary, at }] }
// Redis keys: p:<username> = full state, ps:<username> = small summary for the teacher's table.
const MAX_STATE = 200_000; // bytes of JSON; a very active student is well under this
const STATE_KEYS = ["lessons", "puzzles", "tests", "practice", "days", "lv"];
const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const num = (v, max = 1e7) => (Number.isFinite(+v) ? Math.max(0, Math.min(max, Math.round(+v))) : 0);
const str = (v, n = 40) => (typeof v === "string" ? v.slice(0, n) : "");

function cleanSummary(s = {}) {
  const lt = s.lastTest && typeof s.lastTest === "object" ? s.lastTest : null;
  return {
    xp: num(s.xp), rank: str(s.rank, 12), streak: num(s.streak, 9999), todayXP: num(s.todayXP),
    week: Array.isArray(s.week) ? s.week.slice(0, 7).map((x) => num(x)) : [],
    lessonsDone: num(s.lessonsDone, 999), lessonsTotal: num(s.lessonsTotal, 999),
    puzzlesSolved: num(s.puzzlesSolved, 99999), puzzleLevel: num(s.puzzleLevel, 999), levelsDone: num(s.levelsDone, 999),
    levelsTotal: num(s.levelsTotal, 999), stars: num(s.stars, 9999), classicSolved: num(s.classicSolved, 9999),
    practiceSolved: num(s.practiceSolved, 9999), practiceTotal: num(s.practiceTotal, 9999),
    tests: num(s.tests, 9999), bestTest: s.bestTest == null ? null : num(s.bestTest, 100),
    lastTest: lt ? { score: num(lt.score, 100), total: num(lt.total, 100), tier: str(lt.tier, 16), at: str(lt.at, 30) } : null,
    lastActive: str(s.lastActive, 10),
    daysActive: num(s.daysActive, 99999),
  };
}

export default handler(async ({ req, body }) => {
  const me = await whoIs(req);
  if (req.method === "GET") {
    if (me.role === "teacher") {
      const users = (await listUsers()).filter((u) => u.role === "student");
      if (!users.length) return { students: [] };
      const vals = await kv("MGET", ...users.map((u) => "ps:" + u.username));
      return { students: users.map((u, i) => { const p = parse(vals[i]); return { ...u, summary: p ? p.summary : null, at: p ? p.at : null }; }) };
    }
    return { progress: parse(await kv("GET", "p:" + me.id)) };
  }
  if (req.method !== "POST") throw new HttpError(405, "Use GET or POST.");
  if (me.role !== "student") throw new HttpError(403, "Only students' progress is saved.");
  const src = body.state && typeof body.state === "object" ? body.state : null;
  if (!src) throw new HttpError(400, "No progress was sent.");
  const state = {}; for (const k of STATE_KEYS) if (src[k] !== undefined) state[k] = src[k];
  const json = JSON.stringify(state);
  if (json.length > MAX_STATE) throw new HttpError(413, "Progress is too large to save.");
  const at = Date.now();
  await kvPipe([
    ["SET", "p:" + me.id, JSON.stringify({ state, at })],
    ["SET", "ps:" + me.id, JSON.stringify({ summary: cleanSummary(body.summary), at })],
  ]);
  return { at };
}, { needs: ["base", "db"] });
