import { handler, kv } from "./_lib.js";

// Called once a day by Vercel Cron (see vercel.json) so the free Upstash database is never
// archived for being idle (for example during school holidays). It only writes a timestamp.
export default handler(async () => {
  await kv("SET", "keepalive", String(Date.now()));
  return { ok: true };
}, { needs: ["db"] });
