// Sends one plain-text email through Resend (https://resend.com, free plan: 100 emails a day).
// All email goes through this one function, so changing provider later means changing only this file.
// Settings (Vercel > Project > Settings > Environment Variables):
//   RESEND_API_KEY  the API key from Resend. Without it nothing is sent and the app says email reminders are not switched on.
//   MAIL_FROM       e.g.  Chess Sathi <reminders@yourdomain.com>  (a domain verified in Resend). Until you verify a domain, Resend only
//                   delivers to your own address, using its test sender (the default below).
export const mailReady = () => !!process.env.RESEND_API_KEY;

// Never throws: returns { ok:true } or { ok:false, reason } so one bad address never stops the other reminders.
export async function sendMail({ to, subject, text }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, reason: "not-configured" };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.MAIL_FROM || "Chess Sathi <onboarding@resend.dev>", to: [to], subject, text }),
    });
    return r.ok ? { ok: true } : { ok: false, reason: "status " + r.status };
  } catch { return { ok: false, reason: "network" }; }
}
