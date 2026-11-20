import crypto from "node:crypto";
import { handler, HttpError, kv, kvPipe, getUser, listUsers } from "./_lib.js";
import { refreshList } from "./_tournaments.js";
import { dueReminder, reminderMail, todayIST } from "./_tourney.js";
import { sendMail } from "./_mail.js";

// The daily job (Vercel Cron, see vercel.json). It does two things, once a day, around 8 AM in Bangalore:
//  1. refreshes the shared Karnataka tournament list from the AICF site;
//  2. emails the parents of every child whose tournament has a reminder due today (7 days / 1 day / the day itself, as the parent chose).
// Vercel Cron sends  Authorization: Bearer <CRON_SECRET>.  Without CRON_SECRET set, the job refuses to run, so nobody else can trigger emails.
// Every reminder is recorded on the tournament (sent:[days]), so a second run the same day sends nothing new.
const same = (a, b) => { const x = crypto.createHash("sha256").update(String(a)).digest(), y = crypto.createHash("sha256").update(String(b)).digest(); return crypto.timingSafeEqual(x, y); };

// Send every reminder that is due. `send` can be swapped in tests.
export async function sendDue({ today, send = sendMail, appUrl = "" } = {}) {
  const users = await listUsers(), kids = users.filter((u) => u.role === "student"), out = { checked: 0, sent: 0, noEmail: 0, failed: 0, notConfigured: 0 };
  if (!kids.length) return out;
  const vals = await kv("MGET", ...kids.map((k) => "t:" + k.username)), emails = {};
  const addressesFor = async (child) => {
    if (!emails[child]) emails[child] = (await Promise.all(users.filter((u) => u.role === "parent" && u.child === child).map((p) => getUser(p.username)))).map((r) => r && r.email).filter(Boolean);
    return emails[child];
  };
  for (let i = 0; i < kids.length; i++) {
    let rec; try { rec = vals[i] ? JSON.parse(vals[i]) : null; } catch { rec = null; }
    if (!rec || !Array.isArray(rec.list)) continue;
    let changed = false;
    for (const t of rec.list) {
      const due = dueReminder(t, today); out.checked++;
      if (!due) continue;
      const to = await addressesFor(kids[i].username);
      if (!to.length) { out.noEmail++; continue; }                 // stays unsent: an address added later can still get it
      const mail = reminderMail(t, due.left, appUrl); let ok = 0;
      for (const a of to) {
        const r = await send({ to: a, subject: mail.subject, text: mail.text });
        if (r.ok) ok++; else if (r.reason === "not-configured") out.notConfigured++; else out.failed++;
      }
      if (ok) { out.sent += ok; t.sent = [...new Set([...(t.sent || []), ...due.mark])]; changed = true; }
    }
    if (changed) await kv("SET", "t:" + kids[i].username, JSON.stringify(rec));
  }
  return out;
}

export default handler(async ({ req }) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new HttpError(503, "The reminder job is not set up yet. Missing settings: CRON_SECRET", "setup");
  if (!same((req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim(), secret)) throw new HttpError(401, "Not allowed.");
  const now = Date.now(), list = await refreshList({ now });
  const mail = await sendDue({ today: todayIST(now), appUrl: (process.env.APP_URL || "").replace(/\/+$/, "") });
  return { list, mail };
}, { needs: ["db"] });
