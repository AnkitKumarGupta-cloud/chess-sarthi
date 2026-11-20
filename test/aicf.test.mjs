// The AICF page reader: npm test. Uses saved sample pages in test/fixtures (the live page cannot be reached from the test).
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseEvents, fetchKarnataka, inKarnataka, isoDate } from "../api/_aicf.js";

const table = fs.readFileSync("test/fixtures/aicf-table.html", "utf8"), text = fs.readFileSync("test/fixtures/aicf-text.html", "utf8");

assert.equal(isoDate("16-08-2026"), "2026-08-16"); assert.equal(isoDate("1/2/2026"), "2026-02-01"); assert.equal(isoDate("32-13-2026"), null); assert.equal(isoDate("30-02-2026"), null);

for (const [layout, html] of [["table", table], ["text", text]]) {
  const { list } = parseEvents(html), by = (code) => list.find((e) => e.code === code);
  assert.equal(list.length, 12, layout + ": 13 rows, the one with impossible dates is dropped");
  assert.ok(!list.some((e) => /Broken Dates/.test(e.name)), layout + ": impossible dates are skipped, not guessed");
  const g = by("478632");
  assert.equal(g.name, "Golden Aura’s All India Open FIDE RATED RAPID Chess Tournament 2026", layout + ": HTML entities are decoded");
  assert.deepEqual([g.start, g.end, g.place], ["2026-05-30", "2026-05-31", "Bangalore"]);
  assert.equal(g.link, "https://aicf.in/wp-content/uploads/2026/05/golden-aura.pdf");
  assert.equal(by("501318").link, null, layout + ": a placeholder link like http://475826 is not kept");
  assert.equal(by("502200").link, null, layout + ": http://Visakhapatnam is not kept");
  assert.deepEqual([by("502200").start, by("502200").end], ["2026-07-25", "2026-07-25"], layout + ": end before start becomes a one-day event");
  const noCode = list.find((e) => /Inventive/.test(e.name));
  assert.equal(noCode.code, "", layout + ": a row without an event code still works"); assert.match(noCode.id, /^e[0-9a-f]{11}$/);
  assert.equal(new Set(list.map((e) => e.id)).size, list.length, layout + ": ids are unique");
}
assert.deepEqual(parseEvents(table).list.map((e) => e.id), parseEvents(text).list.map((e) => e.id), "both layouts give the same ids (a parent's 'going' survives a redesign)");

// Karnataka filter
const names = (l) => l.map((e) => e.place || e.name);
const ka = parseEvents(table).list.filter(inKarnataka);
assert.deepEqual(names(ka).sort(), ["Bangalore", "Bangalore", "Bangalore, Karnataka", "Bangalore, Karnataka", "Karnataka", "Mangalore", "Mysuru"].sort());
assert.ok(!inKarnataka({ name: "Pune Grand Prix", place: "Pune" }));
assert.ok(inKarnataka({ name: "Bengaluru Open", place: "" }), "the name can say it when the place is empty");

// The fetch: success keeps only Karnataka; problems throw plain messages
const ok = (body, status = 200) => async () => ({ ok: status < 300, status, text: async () => body });
let r = await fetchKarnataka({ today: "2026-11-20", fetchFn: ok(table) });
assert.equal(r.total, 12);
assert.ok(r.list.every((e) => e.end >= "2026-11-13"), "events over for more than a week are dropped");
assert.deepEqual(r.list.map((e) => e.code).sort(), ["", "501318", "501999", "502100"].sort());
await assert.rejects(fetchKarnataka({ fetchFn: ok("", 503) }), /status 503/);
await assert.rejects(fetchKarnataka({ fetchFn: ok("<html><body>Maintenance</body></html>") }), /looks different/);
await assert.rejects(fetchKarnataka({ fetchFn: async () => { throw new Error("getaddrinfo ENOTFOUND"); } }), /ENOTFOUND/);
console.log("AICF reader checks passed.");
