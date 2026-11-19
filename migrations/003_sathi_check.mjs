// 003: Sathi Check, think-first mode (Phase 4).
// Two small, backwards-compatible additions, so there is nothing to rewrite for existing students:
//  1. p:<student> state may now hold the key "sc" (the child's Think first on/off choice). Missing = the default (off).
//  2. An attempt in at:<student> may carry an optional 8th item c (1 = did the checklist, 0 = did not).
//     Older 7-item attempts stay as they are; the parent line only counts attempts that have c.
// This file exists so the schema version records that these shapes now exist.
export const description = "record the optional 'sc' progress key and the optional 8th attempt field 'c'; existing data is untouched";
export async function up({ log }) { log("   'sc' and attempt field 'c' are optional and appear when a child first uses Think first. Nothing to do."); return { created: 0 }; }
