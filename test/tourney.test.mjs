// Tournament planner logic (Phase 5): npm test
import assert from "node:assert/strict";
import { validDay, daysUntil, todayIST, cleanLink, cleanEvent, eventId, mergeEvents, cleanRem, makeTournament, updateTournament, dueReminder, reminderMail, whenWords, emailOk } from "../api/_tourney.js";

// ---- dates
assert.ok(validDay("2026-02-28")); assert.ok(!validDay("2026-02-30")); assert.ok(!validDay("26-02-28")); assert.ok(!validDay(null));
assert.equal(daysUntil("2026-12-01", "2026-11-20"), 11); assert.equal(daysUntil("2026-11-20", "2026-11-20"), 0); assert.equal(daysUntil("2026-11-19", "2026-11-20"), -1);
// 10:00 PM UTC on the 19th is already 3:30 AM on the 20th in Bangalore
assert.equal(todayIST(Date.parse("2026-11-19T22:00:00Z")), "2026-11-20");
assert.equal(todayIST(Date.parse("2026-11-19T10:00:00Z")), "2026-11-19");
assert.equal(whenWords(0), "is today"); assert.equal(whenWords(1), "is tomorrow"); assert.equal(whenWords(5), "is in 5 days");

// ---- links
assert.equal(cleanLink("https://aicf.in/a.pdf"), "https://aicf.in/a.pdf");
for (const bad of ["http://475826", "http://Visakhapatnam", "javascript:alert(1)", "ftp://a.com/x", "http://127.0.0.1/x", "https://u:p@a.com/", "", null, "not a url"]) assert.equal(cleanLink(bad), null, String(bad));

// ---- events
const e = cleanEvent({ name: "  Bengaluru <b>Open</b>  ", code: "48-6125", start: "2026-12-05", end: "2026-12-04", place: "Bangalore", link: "https://x.org/y" });
assert.ok(!/[<>]/.test(e.name), "angle brackets are removed from names"); assert.equal(e.end, "2026-12-05", "end before start -> one day"); assert.equal(e.code, "486125");
assert.equal(cleanEvent({ name: "ab", start: "2026-12-05" }), null, "name too short"); assert.equal(cleanEvent({ name: "Good name", start: "nope" }), null);
assert.equal(cleanEvent({ name: "Long event", start: "2026-01-01", end: "2026-12-31" }).end, "2026-01-01", "an end date months later is a typo");
assert.equal(eventId({ code: "1", name: "a", start: "x" }), eventId({ code: "1", name: "different", start: "y" }), "the code decides the id");
assert.notEqual(eventId({ code: "", name: "a b", start: "2026-01-01" }), eventId({ code: "", name: "a c", start: "2026-01-01" }));

// ---- the list parents see
const A = cleanEvent({ name: "Alpha Open", start: "2026-12-10", end: "2026-12-10", code: "1" }), B = cleanEvent({ name: "Beta Open", start: "2026-11-25", end: "2026-11-26", code: "2" });
const OLD = cleanEvent({ name: "Old Open", start: "2026-11-01", end: "2026-11-02", code: "3" }), HID = cleanEvent({ name: "Hidden Open", start: "2026-12-20", end: "2026-12-20", code: "4" });
const EXTRA = cleanEvent({ name: "Teacher Added", start: "2026-11-22", end: "2026-11-22", code: "" });
const list = mergeEvents([A, B, OLD, HID, A], { hidden: [HID.id], extra: [EXTRA] }, "2026-11-20");
assert.deepEqual(list.map((x) => x.name), ["Teacher Added", "Beta Open", "Alpha Open"], "soonest first; over, hidden and duplicate events are gone; teacher's extras are in");
assert.equal(mergeEvents([B], { hidden: [], extra: [] }, "2026-11-26").length, 1, "an event still on its last day is still listed");

// ---- a tournament a parent chose
assert.deepEqual(cleanRem([1, 7, 7, 99, "x", 0]), [7, 1, 0]); assert.deepEqual(cleanRem(undefined), [7, 1, 0]); assert.deepEqual(cleanRem([]), []);
const t = makeTournament({ status: "going", rem: [7, 1, 0], note: "ignored" }, A);
assert.equal(t.ref, A.id); assert.equal(t.name, "Alpha Open"); assert.equal(t.status, "going"); assert.deepEqual(t.todo, { entry: false, travel: false, kit: false }); assert.equal(t.note, "");
assert.equal(makeTournament({ name: "x" }, null), null, "a typed-in tournament needs a real name and date");
const own = makeTournament({ name: "School Zonal", start: "2026-12-02", end: "2026-12-02", place: "My school", status: "maybe" }, null);
assert.equal(own.ref, ""); assert.equal(own.status, "maybe");
let u = updateTournament(t, { name: "HACKED", start: "2027-01-01", result: "4/7", note: "n".repeat(500), todo: { entry: true, bogus: true }, rem: [1] });
assert.equal(u.name, "Alpha Open", "a copied tournament keeps the public facts"); assert.equal(u.start, "2026-12-10");
assert.equal(u.result, "4/7"); assert.equal(u.note.length, 300); assert.deepEqual(u.todo, { entry: true, travel: false, kit: false }); assert.deepEqual(u.rem, [1]);
u = updateTournament({ ...own, sent: [7] }, { start: "2026-12-09" });
assert.equal(u.start, "2026-12-09", "a typed-in tournament can be corrected"); assert.deepEqual(u.sent, [], "a new date resets the reminders already sent");

// ---- which reminder is due today?
const G = (start, extra = {}) => ({ status: "going", start, rem: [7, 1, 0], sent: [], ...extra });
const T0 = "2026-11-20";
assert.deepEqual(dueReminder(G("2026-11-27"), T0), { day: 7, left: 7, mark: [7] }, "exactly 7 days out");
assert.equal(dueReminder(G("2026-11-28"), T0), null, "8 days out: too early");
assert.equal(dueReminder(G("2026-11-27", { sent: [7] }), T0), null, "never twice");
assert.equal(dueReminder(G("2026-11-21", { sent: [7] }), T0).day, 1, "tomorrow");
assert.equal(dueReminder(G("2026-11-20", { sent: [7, 1] }), T0).day, 0, "on the day");
// the daily job missed days: 3 days out and nothing sent -> ONE email (the 7-day one), not two
const late = dueReminder(G("2026-11-23"), T0); assert.equal(late.day, 7); assert.equal(late.left, 3);
// 1 day out, the 7-day one was never sent (tournament added late): send the 1-day one and count the 7 as sent too
const added = dueReminder(G("2026-11-21"), T0); assert.deepEqual(added.mark.sort((a, b) => b - a), [7, 1]);
assert.equal(dueReminder(G("2026-11-19"), T0), null, "already over");
assert.equal(dueReminder({ ...G("2026-11-21"), status: "maybe" }, T0), null, "only for tournaments the family is going to");
assert.equal(dueReminder(G("2026-11-21", { rem: [] }), T0), null, "reminders switched off");

// ---- the email: facts only, no child's name
const m = reminderMail({ name: "Bengaluru Open", start: "2026-12-05", end: "2026-12-05", place: "Bangalore", link: "https://x.org/y", todo: { entry: true, travel: false, kit: false } }, 7, "https://chess.example");
assert.equal(m.subject, "Chess Sathi: Bengaluru Open is in 7 days");
assert.match(m.text, /Date: 2026-12-05\n/); assert.match(m.text, /Place: Bangalore/); assert.match(m.text, /- Travel and stay sorted/); assert.doesNotMatch(m.text, /Entry fee paid/);
assert.match(m.text, /https:\/\/chess.example\/#tourney/);
assert.match(reminderMail({ name: "X Open", start: "2026-12-05", end: "2026-12-05", todo: {} }, 0).subject, /is today$/);
assert.doesNotMatch(reminderMail({ name: "X Open", start: "2026-12-05", end: "2026-12-05", todo: {} }, 0).text, /Still to do/, "no to-do list on the day itself");

// ---- email addresses
assert.equal(emailOk(" Parent@Example.com "), "parent@example.com"); for (const bad of ["a@b", "a b@c.com", "<x>@y.com", "", null, "a@b.c"]) assert.equal(emailOk(bad), null, String(bad));
console.log("Tournament planner checks passed.");
