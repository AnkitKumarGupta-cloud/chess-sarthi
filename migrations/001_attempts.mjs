// 001: the weakness tracker (Phase 2).
// Every student gets an attempts record  at:<username> = { v:1, seed:{theme:[tries, misses]}, list:[] }.
// "seed" is filled from what the app already knew about the child (their per-theme counts from before), so the weak-theme
// list works from day one instead of starting empty. New attempts then go into "list" as the child plays.
// Old counts could not tell a hint from a wrong move, so a puzzle solved with a hint counts as a miss in the seed. That is a small
// over-count that corrects itself as real attempts arrive.
export const description = "create the attempts record for every student, seeded from their existing per-theme counts";

const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

export async function up({ kv, kvPipe, listUsers, dry, log }) {
  const students = (await listUsers()).filter((u) => u.role === "student");
  let created = 0, seeded = 0, kept = 0;
  for (const u of students) {
    if ((await kv("GET", "at:" + u.username)) != null) { kept++; continue; }       // already has one: never overwrite
    const p = parse(await kv("GET", "p:" + u.username));
    const th = p && p.state && p.state.pm && p.state.pm.th && typeof p.state.pm.th === "object" ? p.state.pm.th : {};
    const seed = {};
    for (const [t, v] of Object.entries(th)) {
      if (!/^[A-Za-z0-9]{2,32}$/.test(t) || !Array.isArray(v)) continue;
      const tries = Math.max(0, Math.min(99999, Math.round(+v[0]) || 0)), clean = Math.max(0, Math.min(tries, Math.round(+v[1]) || 0));
      if (tries) seed[t] = [tries, tries - clean];
    }
    if (Object.keys(seed).length) seeded++;
    created++;
    log(`  ${dry ? "would create" : "created"} at:${u.username} (${Object.keys(seed).length} themes)`);
    if (!dry) await kvPipe([["SET", "at:" + u.username, JSON.stringify({ v: 1, seed, list: [] })]]);
  }
  return { students: students.length, created, seeded, kept };
}
