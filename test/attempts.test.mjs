// Weakness tracker: attempts, weak themes, parent access, erase, migration (fake Redis, no account needed): npm test
import assert from "node:assert/strict";
import { useEnv, db } from "./fakes.mjs";
useEnv();
const { cleanAttempt, addAttempts, emptyRecord, weakStats, MAX_ATTEMPTS } = await import("../api/_weak.js");

// ---------- pure logic ----------
const NOW = Date.UTC(2026, 10, 19, 10, 0, 0);
assert.equal(cleanAttempt(null), null);
assert.equal(cleanAttempt({ k: "a", id: "x1", th: "short long", ok: 1 }), null, "only generic tags: nothing to learn from");
assert.equal(cleanAttempt({ id: "x1", th: "fork" }), null, "needs an id for dedupe");
const c = cleanAttempt({ k: "a-b!c", id: "AbC12", th: "fork short <script> pin", ok: true, s: 99999, t: NOW, d: "2026-11-19" }, NOW);
assert.deepEqual(c, ["abc", "AbC12", "fork pin", 1, 3600, NOW, "2026-11-19"], "cleaned: junk themes dropped, seconds capped");
assert.equal(cleanAttempt({ k: "q", id: "w", th: "fork", ok: 0, t: NOW + 9e9 }, NOW)[5], NOW, "a time far in the future is replaced by now");

const rec = emptyRecord();
assert.equal(addAttempts(rec, [{ k: "1", id: "p1", th: "fork", ok: 0, t: NOW }, { k: "1", id: "p1", th: "fork", ok: 0, t: NOW }], NOW), 1, "same k is never saved twice");
for (let i = 0; i < MAX_ATTEMPTS + 30; i++) addAttempts(rec, [{ k: "n" + i, id: "p" + i, th: "pin", ok: 1, t: NOW + i }], NOW + 1e4);
assert.equal(rec.list.length, MAX_ATTEMPTS, "the oldest attempts are dropped once the cap is reached");

// weak themes: failure rate AND enough tries; a first wrong move is a failure even if the puzzle was solved on the 2nd try
const r2 = emptyRecord();
const att = (k, th, ok, d) => ({ k, id: "z" + k, th, ok, s: 20, t: Date.parse(d + "T09:00:00Z"), d });
addAttempts(r2, [
  att("a1", "fork", 0, "2026-11-17"), att("a2", "fork", 0, "2026-11-17"), att("a3", "fork", 1, "2026-11-18"), att("a4", "fork", 0, "2026-11-18"), // fork 3 of 4 failed
  att("b1", "pin", 1, "2026-11-18"), att("b2", "pin", 1, "2026-11-18"), att("b3", "pin", 1, "2026-11-19"), att("b4", "pin", 0, "2026-11-19"),   // pin 1 of 4: fine
  att("c1", "skewer", 0, "2026-11-19"), att("c2", "skewer", 0, "2026-11-19"),                                                                    // skewer: only 2 tries, too few to judge
], NOW);
const st = weakStats(r2, "2026-11-19");
assert.deepEqual(st.weak.map((x) => x.id), ["fork"], "only fork is weak (skewer has too few tries, pin fails too rarely)");
assert.equal(st.weak[0].tries, 4); assert.equal(st.weak[0].fails, 3);
assert.equal(st.streak, 3, "17th, 18th and 19th in a row");
assert.equal(weakStats(r2, "2026-11-20").streak, 3, "today not played yet does not break the streak");
assert.equal(weakStats(r2, "2026-11-21").streak, 0, "a missed day does");
assert.equal(st.week.length, 7); assert.equal(st.week[6].d, "2026-11-19"); assert.equal(st.week[6].n, 4);
// the old counts from before this feature (migration seed) count too
const r3 = { v: 1, seed: { fork: [10, 8], mateIn1: [6, 0] }, list: [] };
assert.deepEqual(weakStats(r3, "2026-11-19").weak.map((x) => x.id), ["fork"]);

// ---------- through the API ----------
const load = async (f) => (await import("../api/" + f + ".js")).default;
async function call(file, { method = "GET", body, query = {}, auth } = {}) {
  if (file === "attempts") { file = "progress"; query = { ...query, x: "attempts" }; }   // shares progress.js (vercel.json rewrite)
  const h = await load(file); let status, out;
  const res = { setHeader() {}, status(s) { status = s; return this; }, json(j) { out = j; } };
  await h({ method, body, query, headers: auth ? { authorization: "Bearer " + auth } : {} }, res);
  return { status, ...out };
}
const login = async (u, p) => { const r = await call("login", { method: "POST", body: { username: u, password: p } }); assert.equal(r.status, 200, "login " + u); return r.token; };
const T = await login("teacher", "chess-teacher-pw");
const mk = async (name, batch = "Beginners", extra = {}) => (await call("users", { method: "POST", auth: T, body: { name, batch, ...extra } })).accounts;
const [rohan] = await mk("Rohan Gupta"), [meera] = await mk("Meera Rao");
const R = await login(rohan.username, rohan.password), M = await login(meera.username, meera.password);

// a student saves attempts; the same ones twice are counted once
const batch = [att("s1", "fork", 0, "2026-11-19"), att("s2", "fork", 0, "2026-11-19"), att("s3", "fork", 0, "2026-11-19"), att("s4", "fork", 1, "2026-11-19")];
assert.equal((await call("attempts", { method: "POST", auth: R, body: { attempts: batch } })).saved, 4);
assert.equal((await call("attempts", { method: "POST", auth: R, body: { attempts: batch } })).saved, 0);
assert.equal((await call("attempts", { method: "POST", auth: R, body: {} })).status, 400);
assert.equal((await call("attempts", { method: "POST", auth: T, body: { attempts: batch } })).status, 403, "the teacher does not play puzzles");
let g = await call("attempts", { auth: R, query: { today: "2026-11-19" } });
assert.equal(g.status, 200); assert.equal(g.student.username, rohan.username); assert.deepEqual(g.stats.weak.map((x) => x.id), ["fork"]);
assert.equal((await call("attempts")).status, 401);
assert.equal((await call("attempts", { auth: R, query: { student: meera.username } })).status, 403, "a student cannot read another student");
assert.equal((await call("attempts", { auth: T })).status, 400, "the teacher must say which student");
assert.equal((await call("attempts", { auth: T, query: { student: rohan.username } })).stats.total, 4);
assert.equal((await call("attempts", { auth: T, query: { student: "nobody" } })).status, 404);

// a parent is linked to ONE child and sees only that child
assert.equal((await call("users", { method: "POST", auth: R, body: { action: "addParent", username: rohan.username } })).status, 403, "only the teacher adds parents");
const [pr] = (await call("users", { method: "POST", auth: T, body: { action: "addParent", username: rohan.username } })).accounts;
assert.equal(pr.role, "parent"); assert.equal(pr.child, rohan.username);
assert.equal((await call("users", { method: "POST", auth: T, body: { action: "addParent", username: "nobody" } })).status, 404);
await call("users", { method: "POST", auth: T, body: { action: "addParent", username: rohan.username } });
assert.equal((await call("users", { method: "POST", auth: T, body: { action: "addParent", username: rohan.username } })).status, 400, "at most 2 parent logins per child");
const [pm] = (await call("users", { method: "POST", auth: T, body: { action: "addParent", username: meera.username } })).accounts;
const P = await login(pr.username, pr.password), PM = await login(pm.username, pm.password);
assert.equal((await call("me", { auth: P })).user.child, rohan.username);
g = await call("attempts", { auth: P, query: { today: "2026-11-19" } });
assert.equal(g.status, 200); assert.equal(g.student.username, rohan.username); assert.equal(g.stats.weak[0].id, "fork");
assert.equal((await call("attempts", { auth: P, query: { student: meera.username } })).status, 403, "a parent cannot read someone else's child");
assert.equal((await call("attempts", { auth: PM, query: { student: rohan.username } })).status, 403);
assert.equal((await call("attempts", { method: "POST", auth: P, body: { attempts: batch } })).status, 403, "parents cannot add attempts");
const D = await call("login", { method: "POST", body: { username: "demo", password: "x" } }); assert.equal(D.status, 401);
assert.ok(!JSON.stringify(g).includes("pw"), "no password data leaks");

// erase: the child cannot erase, the parent can; an old phone cannot put the data back
await call("progress", { method: "POST", auth: R, body: { state: { days: { "2026-11-19": 30 } }, summary: { xp: 30 }, resetAck: 0 } });
assert.equal((await call("attempts", { method: "DELETE", auth: R, query: { student: rohan.username } })).status, 403);
assert.equal((await call("attempts", { method: "DELETE", auth: PM, query: { student: rohan.username } })).status, 403, "the other child's parent cannot erase");
assert.equal((await call("attempts", { method: "DELETE", auth: P })).ok, true);
assert.equal(db.has("at:" + rohan.username), false); assert.equal(db.has("p:" + rohan.username), false); assert.equal(db.has("ps:" + rohan.username), false);
assert.equal((await call("attempts", { auth: P })).stats.total, 0);
assert.equal((await call("attempts", { auth: M })).stats.total, 0, "Meera was not touched");
const stale = await call("progress", { method: "POST", auth: R, body: { state: { days: { "2026-11-19": 30 } }, summary: {}, resetAck: 0 } });
assert.equal(stale.status, 409); assert.equal(stale.code, "reset");
assert.equal((await call("attempts", { method: "POST", auth: R, body: { attempts: batch, resetAck: 0 } })).code, "reset");
const back = await call("progress", { auth: R }); assert.equal(back.progress, null); assert.ok(back.reset > 0);
assert.equal((await call("progress", { method: "POST", auth: R, body: { state: { days: {} }, summary: {}, resetAck: back.reset } })).status, 200, "after it has seen the erase, the phone can save again");
assert.equal((await call("attempts", { method: "POST", auth: R, body: { attempts: batch, resetAck: back.reset } })).saved, 4);

// deleting a student removes their data and their parent logins, and nobody else's
await call("attempts", { method: "POST", auth: M, body: { attempts: [att("m1", "pin", 1, "2026-11-19")] } });
assert.equal((await call("users", { method: "DELETE", auth: T, query: { username: rohan.username } })).ok, true);
for (const k of ["u:", "at:", "p:", "ps:", "reset:"]) assert.equal(db.has(k + rohan.username), false, k + " is gone");
assert.equal(db.has("u:" + pr.username), false, "the parent login goes with the child");
assert.equal(db.has("u:" + pm.username), true, "Meera's parent is untouched"); assert.ok(db.has("at:" + meera.username));
assert.equal((await call("me", { auth: P })).status, 401);

// withParent at creation
const both = await mk("Ishaan Verma", "Beginners", { withParent: true });
assert.deepEqual(both.map((a) => a.role), ["student", "parent"]); assert.equal(both[1].child, both[0].username);

// ---------- migrations ----------
const { runMigrations } = await import("../migrations/run.mjs");
const quiet = () => {};
const [old] = await mk("Old Student");  // has history from before this feature, but no at: record
db.set("p:" + old.username, JSON.stringify({ at: 1, state: { pm: { th: { fork: [10, 4], pin: [6, 1], bad_theme: [3, 1] } } } }));
db.delete("at:" + old.username);
const keep = JSON.stringify({ v: 1, seed: {}, list: [["k", "i", "fork", 1, 5, NOW, "2026-11-19"]] });
db.set("at:" + meera.username, keep);
const before = JSON.stringify([...db.entries()].map(([k, v]) => [k, v instanceof Set ? [...v] : v]));
await runMigrations({ dry: true, log: quiet });
assert.equal(JSON.stringify([...db.entries()].map(([k, v]) => [k, v instanceof Set ? [...v] : v])), before, "a dry run changes nothing");
const ran = await runMigrations({ log: quiet });
assert.equal(ran.length, 1);
assert.equal(db.get("schema:version"), "1");
assert.deepEqual(JSON.parse(db.get("at:" + old.username)).seed, { fork: [10, 6], pin: [6, 5] }, "old counts become [tries, misses]; a bad theme name is skipped");
assert.equal(db.get("at:" + meera.username), keep, "an existing record is never overwritten");
assert.ok(db.has("at:" + both[0].username), "every student gets a record");
assert.equal((await runMigrations({ log: quiet })).length, 0, "a second run does nothing");
assert.deepEqual((await call("attempts", { auth: T, query: { student: old.username } })).stats.weak.map((x) => x.id), ["pin", "fork"], "the seeded history already shows weak themes");

console.log("Weakness tracker checks passed.");
