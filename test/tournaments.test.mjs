// Tournament planner through the API (Phase 5): Karnataka list, parent choices, privacy, reminder emails, erase. npm test
import assert from "node:assert/strict";
import fs from "node:fs";
import { useEnv, db, mail, aicf } from "./fakes.mjs";
useEnv({ RESEND_API_KEY: "re_test_key", CRON_SECRET: "cron-secret", MAIL_FROM: "Chess Sathi <r@academy.test>", APP_URL: "https://chess.test" });
const REAL_NOW = Date.now;
Date.now = () => Date.parse("2026-11-20T04:00:00Z");           // 9:30 AM on 20 Nov 2026 in Bangalore: the test never depends on today's date
const TODAY = "2026-11-20";

const load = async (f) => (await import("../api/" + f + ".js")).default;
async function call(file, { method = "GET", body, query = {}, auth } = {}) {
  if (["attempts", "games", "tournaments", "reminders"].includes(file)) { query = { ...query, x: file }; file = "progress"; }   // shares progress.js (vercel.json rewrite)
  const h = await load(file); let status, out;
  const res = { setHeader() {}, status(s) { status = s; return this; }, json(j) { out = j; } };
  await h({ method, body, query, headers: auth ? { authorization: "Bearer " + auth } : {} }, res);
  return { status, ...out };
}
const login = async (u, p) => { const r = await call("login", { method: "POST", body: { username: u, password: p } }); assert.equal(r.status, 200, "login " + u); return r.token; };
const T = await login("teacher", "chess-teacher-pw");
const mk = async (name) => (await call("users", { method: "POST", auth: T, body: { name, batch: "Beginners", withParent: true } })).accounts;
const [rohan, rohanP] = await mk("Rohan Gupta"), [meera, meeraP] = await mk("Meera Rao");
const RS = await login(rohan.username, rohan.password), RP = await login(rohanP.username, rohanP.password), MP = await login(meeraP.username, meeraP.password);
const post = (auth, body) => call("tournaments", { method: "POST", auth, body });
const get = (auth) => call("tournaments", { auth });

// ---------- the shared Karnataka list ----------
aicf.html = fs.readFileSync("test/fixtures/aicf-table.html", "utf8");
assert.equal((await get(RP)).events.length, 0, "empty before the first refresh");
let r = await post(T, { action: "refresh" });
assert.equal(r.ok, true); assert.equal(r.count, 4, "4 Karnataka events not over for more than a week"); assert.equal(r.total, 12);
let g = await get(RP);
assert.deepEqual(g.events.map((e) => e.name.slice(0, 7)), ["Khannur", "Inventi", "Mysuru "], "the one that ended on the 14th is not offered; soonest first");
assert.equal(g.canEdit, true); assert.equal(g.email, ""); assert.equal(g.emailReady, true); assert.deepEqual(g.mine, []);
assert.ok(g.updated > 0);
const mysuru = g.events.find((e) => /Mysuru/.test(e.name)), khannur = g.events.find((e) => /Khannur/.test(e.name));
assert.equal(khannur.link, null, "the placeholder link was dropped");
const sg = await get(RS); assert.equal(sg.canEdit, false, "the child can look"); assert.equal(sg.email, "", "the child never sees the parent address");
assert.equal((await call("tournaments")).status, 401, "sign-in is needed");
assert.equal((await get("demo")).status, 401);

// ---------- a parent chooses ----------
r = await post(RP, { action: "add", eventId: mysuru.id, status: "going" });
assert.equal(r.status, 200); assert.equal(r.tournament.ref, mysuru.id); assert.deepEqual(r.tournament.rem, [7, 1, 0]); assert.equal(r.tournament.name, mysuru.name);
const myId = r.tournament.id;
r = await post(RP, { action: "add", eventId: mysuru.id, status: "maybe" });
assert.equal(r.existed, true, "choosing the same event again changes it, it does not add a second one");
assert.equal((await get(RP)).mine.length, 1); assert.equal((await get(RP)).mine[0].status, "maybe");
assert.equal((await post(RP, { action: "add", eventId: "enope" })).status, 404);
r = await post(RP, { action: "add", name: "School Zonal", start: "2026-11-27", end: "2026-11-27", place: "My school" });
assert.equal(r.tournament.ref, ""); const ownId = r.tournament.id;
assert.equal((await post(RP, { action: "add", name: "x", start: "2026-02-30" })).status, 400);
assert.equal((await post(RS, { action: "add", eventId: mysuru.id })).status, 403, "the child cannot change the plan");
assert.equal((await post(T, { action: "add", eventId: mysuru.id })).status, 400, "the teacher cannot add to a child's plan");

// privacy: the other family sees nothing of this, the teacher has no way to read it
assert.deepEqual((await get(MP)).mine, []);
assert.equal((await post(MP, { action: "update", id: myId, status: "going" })).status, 404, "another family cannot touch it");
assert.equal((await call("tournaments", { method: "DELETE", auth: MP, query: { id: myId } })).status, 200);
assert.equal((await get(RP)).mine.length, 2, "...and their delete did nothing to ours");
const tg = await get(T); assert.equal(tg.mine, undefined); assert.ok(!JSON.stringify(tg).includes("School Zonal"), "teacher's view has no family data");
assert.equal((await call("tournaments", { method: "DELETE", auth: T, query: { id: myId } })).status, 405, "the teacher cannot delete a family plan");

// ---------- checklist, result, email ----------
r = await post(RP, { action: "update", id: myId, status: "going", todo: { entry: true }, result: "4/7", note: "Lost to a fork in round 3" });
assert.deepEqual(r.tournament.todo, { entry: true, travel: false, kit: false }); assert.equal(r.tournament.result, "4/7"); assert.equal(r.tournament.status, "going");
assert.equal((await post(RP, { action: "email", email: "not an email" })).status, 400);
assert.equal((await post(RP, { action: "email", email: " Parent@Example.com " })).email, "parent@example.com");
assert.equal((await get(RP)).email, "parent@example.com"); assert.equal((await get(MP)).email, "", "each parent has their own address");
assert.equal((await post(RS, { action: "email", email: "kid@example.com" })).status, 403);

// ---------- the teacher looks after the list ----------
assert.equal((await post(T, { action: "hide", id: khannur.id })).ok, true);
assert.ok(!(await get(RP)).events.some((e) => e.id === khannur.id), "a hidden event disappears for parents");
assert.equal((await get(T)).events.find((e) => e.id === khannur.id).hidden, true, "...but the teacher still sees it, to un-hide");
await post(T, { action: "hide", id: khannur.id, hidden: false }); assert.ok((await get(RP)).events.some((e) => e.id === khannur.id));
r = await post(T, { action: "addEvent", name: "Academy Inter-Batch Rapid", start: "2026-11-29", end: "2026-11-29", place: "Gupta Chess Academy, Bangalore" });
assert.equal(r.ok, true); assert.ok((await get(RP)).events.some((e) => e.name === "Academy Inter-Batch Rapid"));
assert.equal((await post(RP, { action: "hide", id: khannur.id })).status, 400, "parents cannot hide events");
assert.equal((await post(T, { action: "addEvent", name: "No date" })).status, 400);
await post(T, { action: "removeEvent", id: r.event.id }); assert.ok(!(await get(RP)).events.some((e) => e.name === "Academy Inter-Batch Rapid"));

// ---------- the daily job: refresh + reminder emails ----------
assert.equal((await call("reminders")).status, 401, "needs the cron secret");
assert.equal((await call("reminders", { auth: "wrong" })).status, 401);
// School Zonal is 7 days away and going; Rohan's parent has an address. Meera has a tournament due too but her parent has no address.
await post(RP, { action: "update", id: ownId, status: "going" });
await post(MP, { action: "add", name: "Meera Zonal", start: "2026-11-27", end: "2026-11-27", place: "Hubli" });
r = await call("reminders", { auth: "cron-secret" });
assert.equal(r.status, 200); assert.equal(r.list.ok, true);
assert.equal(r.mail.sent, 1); assert.equal(r.mail.noEmail, 1, "no address: nothing sent, and nothing marked sent");
assert.equal(mail.sent.length, 1); assert.deepEqual(mail.sent[0].to, ["parent@example.com"]); assert.equal(mail.sent[0].from, "Chess Sathi <r@academy.test>");
assert.equal(mail.sent[0].subject, "Chess Sathi: School Zonal is in 7 days");
assert.match(mail.sent[0].text, /Place: My school/); assert.match(mail.sent[0].text, /https:\/\/chess.test\/#tourney/);
assert.ok(!mail.sent[0].text.includes("Rohan"), "the email never names the child");
r = await call("reminders", { auth: "cron-secret" });
assert.equal(r.mail.sent, 0, "a second run the same day sends nothing new");
assert.deepEqual((await get(RP)).mine.find((t) => t.id === ownId).sent, [7]);
// Meera's parent adds an address later: the reminder still goes out (it was not marked sent)
await post(MP, { action: "email", email: "meera.parent@example.com" });
r = await call("reminders", { auth: "cron-secret" }); assert.equal(r.mail.sent, 1); assert.deepEqual(mail.sent[1].to, ["meera.parent@example.com"]);
// the email service is down: counted as failed, NOT marked sent, so tomorrow's run tries again
await post(RP, { action: "update", id: ownId, start: "2026-11-21" });
assert.deepEqual((await get(RP)).mine.find((t) => t.id === ownId).sent, [], "a new date clears old reminders");
mail.fail = true; r = await call("reminders", { auth: "cron-secret" });
assert.equal(r.mail.failed, 1); assert.equal(r.mail.sent, 0); mail.fail = false;
r = await call("reminders", { auth: "cron-secret" }); assert.equal(r.mail.sent, 1); assert.equal(mail.sent.at(-1).subject, "Chess Sathi: School Zonal is tomorrow");
// "maybe" gets no emails
await post(RP, { action: "update", id: ownId, start: "2026-11-20", status: "maybe" });
assert.equal((await call("reminders", { auth: "cron-secret" })).mail.sent, 0);

// the AICF page is down or has changed: the old list stays, the teacher is told why
const before = (await get(RP)).events.length; aicf.status = 503;
r = await call("reminders", { auth: "cron-secret" }); assert.equal(r.list.ok, false); assert.match(r.list.error, /503/);
assert.equal((await get(RP)).events.length, before, "the last good list is kept"); assert.match((await get(T)).err, /503/);
aicf.status = 200; aicf.html = "<html><body>Under maintenance</body></html>";
assert.equal((await post(T, { action: "refresh" })).ok, false); assert.equal((await get(RP)).events.length, before);
aicf.html = fs.readFileSync("test/fixtures/aicf-table.html", "utf8"); assert.equal((await post(T, { action: "refresh" })).ok, true); assert.equal((await get(T)).err, null, "a good fetch clears the error");

// without the secret the job refuses to run at all
delete process.env.CRON_SECRET; assert.equal((await call("reminders", { auth: "cron-secret" })).status, 503); process.env.CRON_SECRET = "cron-secret";

// ---------- erase: removes the child's tournaments too ----------
assert.ok(db.has("t:" + rohan.username));
assert.equal((await call("tournaments", { method: "DELETE", auth: RP, query: { id: myId } })).status, 200); assert.equal((await get(RP)).mine.length, 1);
assert.equal((await call("attempts", { method: "DELETE", auth: RP })).status, 200);
assert.ok(!db.has("t:" + rohan.username), "erasing the child's data removes the tournament plan");
assert.deepEqual((await get(RP)).mine, []);
assert.ok(db.has("t:" + meera.username), "...and only that child's");
// deleting the account removes it as well
await post(MP, { action: "add", name: "Another", start: "2026-12-01" });
await call("users", { method: "DELETE", auth: T, query: { username: meera.username } }); assert.ok(!db.has("t:" + meera.username));

// ---------- migration ----------
const { runMigrations } = await import("../migrations/run.mjs");
db.delete("tl:ka"); db.set("schema:version", "3");
await runMigrations({ dry: true, log() {} }); assert.ok(!db.has("tl:ka"), "--dry changes nothing");
await runMigrations({ log() {} }); assert.deepEqual(JSON.parse(db.get("tl:ka")), { v: 1, at: 0, total: 0, list: [] }); assert.equal(db.get("schema:version"), "4");
await runMigrations({ log() {} });   // safe to run twice

Date.now = REAL_NOW;
console.log("Tournament planner API checks passed.");
