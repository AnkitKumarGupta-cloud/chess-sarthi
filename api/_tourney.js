// Pure logic for the tournament planner (no database, no network), so it is easy to test.
//
// Two kinds of record:
//  * An EVENT is a public tournament from the shared Karnataka list (read from the AICF site, see _aicf.js):
//      { id, name, code, start:"YYYY-MM-DD", end:"YYYY-MM-DD", place, link }
//  * A TOURNAMENT is one a parent has chosen for their child (private, stored in t:<student>):
//      { id, ref, name, start, end, place, link, status:"going"|"maybe", rem:[7,1,0], sent:[days], todo:{entry,travel,kit}, result, note }
//      ref = the event id it was copied from, or "" when the parent typed it in themselves.
import crypto from "node:crypto";

export const MAX_TOURNAMENTS = 40;                 // per child
export const REMIND_CHOICES = [14, 7, 3, 1, 0];    // "days before" a parent can pick; 0 = the morning of the event
export const DEFAULT_REMIND = [7, 1, 0];
export const TODO_KEYS = ["entry", "travel", "kit"];   // entry fee paid / travel and stay sorted / clock, notation sheet and ID packed

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const str = (v, n) => String(v == null ? "" : v).replace(/[<>\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

// A date that really exists, e.g. 2026-02-30 is NOT valid.
export function validDay(s) {
  if (!DAY.test(String(s))) return false;
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}
const dayNum = (d) => Math.round(Date.parse(d + "T00:00:00Z") / 864e5);
export const daysUntil = (start, today) => dayNum(start) - dayNum(today);

// "Today" in India (the academy's time), so a reminder for "tomorrow" means tomorrow in Bangalore, not in UTC.
export const todayIST = (now = Date.now()) => new Date(now + 330 * 6e4).toISOString().slice(0, 10);

// A link we are willing to show: http(s), a real host name with a dot, not an IP address or a bare number
// (the AICF page has placeholder links like "http://475826" and "http://Visakhapatnam").
export function cleanLink(u) {
  try {
    const x = new URL(String(u || "").trim());
    if (!/^https?:$/.test(x.protocol) || x.username || x.password) return null;
    if (!x.hostname.includes(".") || /^[\d.]+$/.test(x.hostname) || /^\[/.test(x.hostname)) return null;
    const s = x.toString();
    return s.length <= 300 ? s : null;
  } catch { return null; }
}

// Same event, same id every day, so a parent's "going" stays linked to it. Uses the AICF event code when there is one.
export const eventId = (e) => "e" + crypto.createHash("sha1").update(e.code ? "c" + e.code : [e.name, e.start].join("|").toLowerCase()).digest("hex").slice(0, 11);

// Cleans one public event. Returns null when it is not usable. An end date before the start date is a typo on the source page,
// so the event becomes a one-day event instead of being thrown away.
export function cleanEvent(e) {
  if (!e || typeof e !== "object") return null;
  const name = str(e.name, 120), start = String(e.start || ""), place = str(e.place, 60);
  if (name.length < 4 || !validDay(start)) return null;
  let end = validDay(e.end) ? e.end : start;
  if (end < start || dayNum(end) - dayNum(start) > 30) end = start;
  const code = String(e.code || "").replace(/[^0-9A-Za-z]/g, "").slice(0, 10);
  const o = { name, code, start, end, place, link: cleanLink(e.link) };
  return { id: eventId(o), ...o };
}

// The list parents see: auto-fetched events + the teacher's extra ones - the ones the teacher hid; only events not over yet; soonest first.
export function mergeEvents(auto, mod, today) {
  const hidden = new Set((mod && mod.hidden) || []), seen = new Set(), out = [];
  for (const e of [...(auto || []), ...((mod && mod.extra) || [])]) {
    if (!e || hidden.has(e.id) || seen.has(e.id) || !validDay(e.end) || e.end < today) continue;
    seen.add(e.id); out.push(e);
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
}

export function cleanRem(r) {
  if (!Array.isArray(r)) return [...DEFAULT_REMIND];
  return [...new Set(r.map(Number).filter((n) => REMIND_CHOICES.includes(n)))].sort((a, b) => b - a);
}
export const cleanTodo = (t) => Object.fromEntries(TODO_KEYS.map((k) => [k, !!(t && t[k])]));
const newId = () => crypto.randomBytes(6).toString("hex");

// A tournament the parent chose. `from` = an event from the shared list (facts are copied), or null for one typed in by hand.
export function makeTournament(body, from) {
  const b = body && typeof body === "object" ? body : {};
  const base = from || cleanEvent({ name: b.name, start: b.start, end: b.end, place: b.place, link: b.link });
  if (!base) return null;
  return {
    id: newId(), ref: from ? from.id : "", name: base.name, start: base.start, end: base.end, place: base.place, link: base.link,
    status: b.status === "maybe" ? "maybe" : "going", rem: cleanRem(b.rem), sent: [], todo: cleanTodo(b.todo), result: "", note: "",
  };
}
// What a parent may change afterwards. Name, dates and place of a typed-in tournament can be fixed; a copied one keeps the public facts.
export function updateTournament(t, b) {
  const o = { ...t };
  if (b.status === "going" || b.status === "maybe") o.status = b.status;
  if (b.rem !== undefined) { o.rem = cleanRem(b.rem); o.sent = o.sent.filter((d) => o.rem.includes(d)); }
  if (b.todo !== undefined) o.todo = cleanTodo(b.todo);
  if (b.result !== undefined) o.result = str(b.result, 40);
  if (b.note !== undefined) o.note = str(b.note, 300);
  if (!t.ref) {
    const e = cleanEvent({ name: b.name !== undefined ? b.name : t.name, start: b.start !== undefined ? b.start : t.start, end: b.end !== undefined ? b.end : t.end, place: b.place !== undefined ? b.place : t.place, link: b.link !== undefined ? b.link : t.link });
    if (e) Object.assign(o, { name: e.name, start: e.start, end: e.end, place: e.place, link: e.link });
  }
  if (o.start !== t.start) o.sent = [];   // a new date means the old reminders no longer apply
  return o;
}

// Words for a countdown.
export const whenWords = (d) => (d < 0 ? "was " + (d === -1 ? "yesterday" : -d + " days ago") : d === 0 ? "is today" : d === 1 ? "is tomorrow" : "is in " + d + " days");

// Which reminder (if any) should go out today? Only for tournaments the family is going to.
// If the daily job missed a day we still send ONE email: the one for the nearest "days before" that has been reached, and the earlier
// (larger) ones are counted as sent, so nobody gets two emails on the same day.
export function dueReminder(t, today) {
  if (!t || t.status !== "going" || !validDay(t.start)) return null;
  const left = daysUntil(t.start, today);
  if (left < 0) return null;
  const sent = new Set(t.sent || []);
  const reached = (t.rem || []).filter((d) => d >= left).sort((a, b) => a - b);   // e.g. rem [7,1,0], 3 days left -> [7]
  if (!reached.length) return null;
  const pick = reached.find((d) => !sent.has(d));
  if (pick === undefined) return null;
  return { day: pick, left, mark: reached };   // `mark`: save all of these as sent
}

// The email. Plain text. It names the tournament, the date and the place and nothing else about the child.
export function reminderMail(t, left, appUrl = "") {
  const todo = TODO_KEYS.filter((k) => !(t.todo && t.todo[k]));
  const label = { entry: "Entry fee paid", travel: "Travel and stay sorted", kit: "Clock, notation sheet and ID packed" };
  const when = left === 0 ? "today" : left === 1 ? "tomorrow" : "in " + left + " days";
  const lines = [`Reminder: ${t.name} ${whenWords(left)}.`, "", `Date: ${t.start}${t.end !== t.start ? " to " + t.end : ""}`];
  if (t.place) lines.push(`Place: ${t.place}`);
  if (t.link) lines.push(`Details: ${t.link}`);
  if (todo.length && left > 0) lines.push("", "Still to do:", ...todo.map((k) => "- " + label[k]));
  lines.push("", "You can change or switch off reminders in Chess Sathi, under Tournaments." + (appUrl ? "\n" + appUrl + "/#tourney" : ""));
  return { subject: `Chess Sathi: ${t.name} is ${when}`.slice(0, 150), text: lines.join("\n") };
}

export const emailOk = (e) => { const s = String(e || "").trim(); return s.length <= 120 && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/.test(s) ? s.toLowerCase() : null; };
