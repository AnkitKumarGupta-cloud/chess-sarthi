// 004: Tournament planner (Phase 5).
//  * tl:ka  = the shared Karnataka tournament list read from the AICF site { v, at, total, list }. Created empty here so the first
//             page load works; the daily job fills it (or the teacher presses "Refresh now").
//  * tl:mod = the teacher's changes to that list { hidden, extra }. Created the first time the teacher hides or adds an event.
//  * t:<student> = a child's chosen tournaments. Created the first time a parent picks one, so nothing to fill in for existing students.
//  * u:<parent> may get an optional  email  (set by the parent, used only for reminder emails).
export const description = "create the empty shared tournament list tl:ka; per-student keys appear when a parent first uses the planner";
export async function up({ kv, dry, log }) {
  if (await kv("GET", "tl:ka")) { log("   tl:ka already exists."); return { created: 0 }; }
  log(`   ${dry ? "would create" : "creating"} tl:ka (empty list)`);
  if (!dry) await kv("SET", "tl:ka", JSON.stringify({ v: 1, at: 0, total: 0, list: [] }));
  return { created: 1 };
}
