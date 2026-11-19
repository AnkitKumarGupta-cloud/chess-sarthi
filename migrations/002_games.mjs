// 002: Game doctor (Phase 3).
// Checked games are kept in  g:<username> = { v:1, list:[ game ] }  (newest 30 per student). The key is created the first time a
// student saves a game check, so there is nothing to fill in for existing students. This file exists so the schema version records that
// the key now exists (and so a future change to its shape has a number to follow).
export const description = "record the new g:<student> key (checked games); nothing to create for existing students";
export async function up({ log }) { log("   g:<student> is created on the first saved game check. Nothing to do."); return { created: 0 }; }
