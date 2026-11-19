// Database migrations for Chess Sathi.
// Redis has no tables, so a "migration" is a small numbered script (NNN_name.mjs) that reshapes or fills keys.
// Each one runs ONCE, in order; the number of the last one that ran is saved in the key  schema:version.
// Every migration is safe to run twice, and the website keeps working if you never run them (old kids just start with no history).
//
//   node migrations/run.mjs            run everything that is new
//   node migrations/run.mjs --dry      show what would happen, change nothing
//
// It needs the database settings (KV_REST_API_URL + KV_REST_API_TOKEN). Put them in .env.local (copy them from the Vercel
// project: Storage > your database > .env.local tab), or set them in the terminal. Never commit .env.local.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations({ dry = false, log = console.log } = {}) {
  const lib = await import("../api/_lib.js");
  const files = fs.readdirSync(here).filter((f) => /^\d{3}_.+\.mjs$/.test(f)).sort();
  const done = +(await lib.kv("GET", "schema:version")) || 0;
  const ran = [];
  for (const f of files) {
    const n = +f.slice(0, 3);
    if (n <= done) { log(`skip   ${f} (already done)`); continue; }
    const m = await import(pathToFileURL(path.join(here, f)).href);
    log(`${dry ? "would run" : "running"} ${f}: ${m.description}`);
    const out = await m.up({ kv: lib.kv, kvPipe: lib.kvPipe, listUsers: lib.listUsers, dry, log });
    if (!dry) await lib.kv("SET", "schema:version", n);
    ran.push({ file: f, ...out });
  }
  log(ran.length ? (dry ? "Dry run finished. Nothing was changed." : "Done.") : "Nothing to do. The database is up to date.");
  return ran;
}

// Only when started from the terminal (not when a test imports it)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { for (const l of fs.readFileSync(path.join(here, "..", ".env.local"), "utf8").split("\n")) { const m = l.match(/^([A-Z0-9_]+)="?([^"\n]*)"?$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; } } catch { /* no .env.local: use the terminal's settings */ }
  runMigrations({ dry: process.argv.includes("--dry") }).catch((e) => { console.error("Migration failed:", e.message); process.exit(1); });
}
