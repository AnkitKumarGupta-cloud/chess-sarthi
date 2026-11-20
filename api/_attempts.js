import { handler, HttpError, whoIs, kv, kvPipe, getUser, normUser } from "./_lib.js";
import { addAttempts, parseRecord, weakStats } from "./_weak.js";

// Every puzzle attempt, so Chess Sathi can find what a child is weak at.
//  POST   (student)  { attempts: [{ k, id, th, ok, s, t, d }] }  -> saves new attempts (the same k is never saved twice)
//  GET    (student)                       -> { stats, summary }  for the signed-in student
//  GET    (parent)                        -> the same, for their own child only
//  GET    (teacher) ?student=<username>   -> the same, for that student
//  DELETE (parent of the child, or teacher)  ?student=<username> -> erases the child's attempts, games, tournaments and saved progress
//         (the account stays; the child's phone clears itself the next time it signs in, see "reset:" below)
// Redis keys: at:<username> = { v, seed, list } (see _weak.js) · g:<username> = checked games (see _games.js) · reset:<username> = when the data was erased (ms)
const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

// Whose data is this call about, and is the caller allowed to see it?
export async function whose(me, query) {
  const asked = normUser(query.student);
  let who;
  if (me.role === "student") who = me.id;
  else if (me.role === "parent") who = me.child;
  else if (me.role === "teacher") who = asked;
  else throw new HttpError(403, "This is not available for this login.");
  if (!who) throw new HttpError(400, me.role === "teacher" ? "Say which student." : "This parent account is not linked to a child yet. Ask the teacher.");
  if (asked && asked !== who) throw new HttpError(403, "You can only see your own child's progress.");
  const rec = await getUser(who);
  if (!rec || rec.role !== "student") throw new HttpError(404, "That student was not found.");
  return rec;
}

export default handler(async ({ req, body, query }) => {
  const me = await whoIs(req);
  if (req.method === "POST") {
    if (me.role !== "student") throw new HttpError(403, "Only students' attempts are saved.");
    const list = body && Array.isArray(body.attempts) ? body.attempts.slice(0, 60) : null;
    if (!list) throw new HttpError(400, "No attempts were sent.");
    if ((+(await kv("GET", "reset:" + me.id)) || 0) > (+body.resetAck || 0)) throw new HttpError(409, "Your data was erased by your parent or teacher.", "reset");
    const rec = parseRecord(await kv("GET", "at:" + me.id));
    const saved = addAttempts(rec, list);
    if (saved) await kv("SET", "at:" + me.id, JSON.stringify(rec));
    return { saved };
  }
  const child = await whose(me, query);
  if (req.method === "DELETE") {
    if (me.role === "student") throw new HttpError(403, "Ask your parent or teacher to erase your data.");
    await kvPipe([["DEL", "at:" + child.username], ["DEL", "g:" + child.username], ["DEL", "p:" + child.username], ["DEL", "ps:" + child.username], ["DEL", "t:" + child.username], ["SET", "reset:" + child.username, Date.now()]]);
    return { ok: true };
  }
  if (req.method !== "GET") throw new HttpError(405, "Use GET, POST or DELETE.");
  const [at, ps, gs] = await Promise.all([kv("GET", "at:" + child.username), kv("GET", "ps:" + child.username), kv("GET", "g:" + child.username)]);
  const sum = parse(ps), s = sum && sum.summary ? sum.summary : null;
  return {
    student: { username: child.username, name: child.name, batchName: child.batchName || null },
    stats: weakStats(parseRecord(at), String(query.today || "")),
    // Only the safe, small summary the parent needs (no puzzle-by-puzzle history beyond the stats above)
    summary: s ? { xp: s.xp, rank: s.rank, streak: s.streak, puzzlesSolved: s.puzzlesSolved, puzzleRating: s.puzzleRating, lastActive: s.lastActive, week: s.week, bestTest: s.bestTest, tests: s.tests } : null,
    at: sum ? sum.at : null,
    games: (parse(gs) || { list: [] }).list.length,
  };
}, { needs: ["base", "db"] });
