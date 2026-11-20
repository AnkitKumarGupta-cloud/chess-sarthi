import { handler, HttpError, whoIs, kv, kvPipe, getUser, putUser, mustBeTeacher } from "./_lib.js";
import { fetchKarnataka } from "./_aicf.js";
import { MAX_TOURNAMENTS, cleanEvent, mergeEvents, makeTournament, updateTournament, todayIST, emailOk } from "./_tourney.js";
import { mailReady } from "./_mail.js";

// Tournament planner.
//  GET     (parent / student / teacher)  -> { today, events, updated, mine?, email?, emailReady, ... }
//            events = the shared Karnataka list (read from the AICF site once a day, see _aicf.js and _reminders.js)
//            mine   = the child's own chosen tournaments (parent, or the child read-only). The teacher never sees these.
//  POST    (parent)  { action:"add", eventId | name,start,end,place,link, status, rem }   choose a tournament for the child
//                    { action:"update", id, status?, rem?, todo?, result?, note?, (name,start,end,place,link for typed-in ones) }
//                    { action:"email", email }   the parent's own address for reminder emails ("" removes it)
//  POST    (teacher) { action:"hide", id, hidden } | { action:"addEvent", name,start,end,place,link } | { action:"removeEvent", id } | { action:"refresh" }
//  DELETE  (parent)  ?id=<tournamentId>  removes one; no id removes all of the child's tournaments
// Redis keys: tl:ka = the list read from AICF { v, at, total, list, err? } · tl:mod = the teacher's changes { hidden:[ids], extra:[events] }
//             t:<student> = { v:1, list:[tournament] }, private to the family: nothing public, erased with the child's data.
const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
export const KEY_LIST = "tl:ka", KEY_MOD = "tl:mod";

const loadMod = async () => { const m = parse(await kv("GET", KEY_MOD)); return { hidden: Array.isArray(m && m.hidden) ? m.hidden : [], extra: Array.isArray(m && m.extra) ? m.extra : [] }; };
const loadAuto = async () => { const r = parse(await kv("GET", KEY_LIST)); return r && Array.isArray(r.list) ? r : { v: 1, at: 0, total: 0, list: [] }; };

// Read the AICF page and store the Karnataka events. If it fails, the last good list is kept and the reason is remembered.
// Used by the daily job and by the teacher's "Refresh now" button.
export async function refreshList({ now = Date.now(), fetchFn } = {}) {
  const old = await loadAuto();
  try {
    const r = await fetchKarnataka({ today: todayIST(now), fetchFn });
    await kv("SET", KEY_LIST, JSON.stringify({ v: 1, at: now, total: r.total, list: r.list }));
    return { ok: true, count: r.list.length, total: r.total };
  } catch (e) {
    await kv("SET", KEY_LIST, JSON.stringify({ ...old, err: e.message, errAt: now }));
    return { ok: false, error: e.message };
  }
}

// Which child is this call about? A parent: their own child (and can change things). A student: themselves, read only.
async function childOf(me) {
  const id = me.role === "parent" ? me.child : me.role === "student" ? me.id : null;
  if (me.role !== "parent" && me.role !== "student") throw new HttpError(403, "Tournament plans are private to the family.");
  if (!id) throw new HttpError(400, "This parent account is not linked to a child yet. Ask the teacher.");
  const rec = await getUser(id);
  if (!rec || rec.role !== "student") throw new HttpError(404, "That student was not found.");
  return rec.username;
}
const loadMine = async (child) => { const r = parse(await kv("GET", "t:" + child)); return { v: 1, list: r && Array.isArray(r.list) ? r.list : [] }; };
const save = (child, rec) => kv("SET", "t:" + child, JSON.stringify(rec));
const byStart = (a, b) => a.start.localeCompare(b.start);

export default handler(async ({ req, body, query }) => {
  const me = await whoIs(req);
  if (me.role === "demo") throw new HttpError(403, "This is not available for this login.");
  const today = todayIST();

  /* ----- teacher: looks after the shared list only ----- */
  if (me.role === "teacher") {
    if (req.method === "POST") {
      const mod = await loadMod();
      if (body.action === "refresh") return await refreshList();
      if (body.action === "hide") {
        const id = String(body.id || "").slice(0, 16);
        mod.hidden = mod.hidden.filter((x) => x !== id); if (body.hidden !== false) mod.hidden.push(id);
        await kv("SET", KEY_MOD, JSON.stringify(mod)); return { ok: true };
      }
      if (body.action === "addEvent") {
        const e = cleanEvent(body); if (!e) throw new HttpError(400, "Please enter a name and a real start date.");
        mod.extra = [...mod.extra.filter((x) => x.id !== e.id), e].slice(-100);
        await kv("SET", KEY_MOD, JSON.stringify(mod)); return { ok: true, event: e };
      }
      if (body.action === "removeEvent") { mod.extra = mod.extra.filter((x) => x.id !== body.id); await kv("SET", KEY_MOD, JSON.stringify(mod)); return { ok: true }; }
      throw new HttpError(400, "Unknown action.");
    }
    if (req.method !== "GET") throw new HttpError(405, "Use GET or POST.");
    const [auto, mod] = await Promise.all([loadAuto(), loadMod()]);
    const events = mergeEvents(auto.list, { hidden: [], extra: mod.extra }, today).map((e) => ({ ...e, hidden: mod.hidden.includes(e.id), mine: mod.extra.some((x) => x.id === e.id) }));
    return { today, events, updated: auto.at || null, err: auto.err || null, emailReady: mailReady() };
  }

  /* ----- parent / student ----- */
  const child = await childOf(me), parent = me.role === "parent";
  if (req.method === "GET") {
    const [auto, mod, mine, urec] = await Promise.all([loadAuto(), loadMod(), loadMine(child), parent ? getUser(me.id) : null]);
    return {
      today, events: mergeEvents(auto.list, mod, today), updated: auto.at || null,
      mine: mine.list.slice().sort(byStart), canEdit: parent, email: parent && urec && urec.email ? urec.email : "", emailReady: mailReady(),
    };
  }
  if (!parent) throw new HttpError(403, "Ask your parent to change the tournament plan.");

  if (req.method === "DELETE") {
    const id = String(query.id || "");
    if (!id) { await kv("DEL", "t:" + child); return { ok: true }; }
    const rec = await loadMine(child); rec.list = rec.list.filter((t) => t.id !== id); await save(child, rec);
    return { ok: true };
  }
  if (req.method !== "POST") throw new HttpError(405, "Use GET, POST or DELETE.");

  if (body.action === "email") {
    const raw = String(body.email || "").trim(), e = raw ? emailOk(raw) : "";
    if (raw && !e) throw new HttpError(400, "That email address does not look right.");
    const rec = await getUser(me.id); if (e) rec.email = e; else delete rec.email;
    await putUser(rec);
    return { email: e || "" };
  }
  const rec = await loadMine(child);
  if (body.action === "add") {
    let from = null;
    if (body.eventId) {
      const [auto, mod] = await Promise.all([loadAuto(), loadMod()]);
      from = mergeEvents(auto.list, mod, "0000-01-01").find((e) => e.id === body.eventId) || null;
      if (!from) throw new HttpError(404, "That tournament is not on the list any more.");
      const have = rec.list.find((t) => t.ref === from.id);
      if (have) { Object.assign(have, updateTournament(have, { status: body.status })); await save(child, rec); return { tournament: have, existed: true }; }
    }
    if (rec.list.length >= MAX_TOURNAMENTS) throw new HttpError(400, "That is a lot of tournaments. Please remove some old ones first.");
    const t = makeTournament(body, from);
    if (!t) throw new HttpError(400, "Please enter a name and a real start date.");
    rec.list.push(t); await save(child, rec);
    return { tournament: t };
  }
  if (body.action === "update") {
    const i = rec.list.findIndex((t) => t.id === body.id);
    if (i < 0) throw new HttpError(404, "That tournament was not found.");
    rec.list[i] = updateTournament(rec.list[i], body); await save(child, rec);
    return { tournament: rec.list[i] };
  }
  throw new HttpError(400, "Unknown action.");
}, { needs: ["base", "db"] });
