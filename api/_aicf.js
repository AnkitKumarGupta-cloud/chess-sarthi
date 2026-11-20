// Reads the public "all events" page of the All India Chess Federation and keeps the Karnataka tournaments.
//   https://aicf.in/all-events/   each event has: name, event code, start date, end date, place, brochure link.
// There is no API or feed, so we read the page's HTML. That can break if AICF redesigns the page, so:
//  * the reader tries a TABLE layout first, then a plain-TEXT layout;
//  * every row is checked (real dates, usable link) and bad rows are skipped, never guessed;
//  * if almost nothing could be read, the whole fetch counts as failed and the last good list stays (see _tournaments.js).
// We only keep facts (name, dates, place, link back to AICF's own brochure). Nothing is copied from the PDFs.
import { cleanEvent, cleanLink, validDay } from "./_tourney.js";

export const SOURCE_URL = "https://aicf.in/all-events/";
export const MIN_ROWS = 10;   // fewer rows than this on the whole page = the layout probably changed

// Words that mean "in Karnataka" (cities where Gupta Chess Academy kids can reach). Matched in the place, or in the name for the 3 big ones.
const KA_PLACE = /bangalore|bengaluru|bangaluru|karnataka|mysuru|mysore|mangaluru|mangalore|belagavi|belgaum|hubballi|hubli|dharwad|shivamogga|shimoga|davangere|davanagere|haveri|udupi|ballari|bellary|tumakuru|tumkur|kalaburagi|gulbarga|vijayapura|bijapur|hassan|mandya|chitradurga|kolar|raichur|bidar|sandur|chikkamagaluru|chikmagalur|madikeri|kodagu|coorg|gadag|koppal|bagalkot|ramanagara|chikkaballapur|karwar|sirsi|puttur|manipal|dandeli|hosapete|hospet/i;
const KA_NAME = /bangalore|bengaluru|karnataka/i;
export const inKarnataka = (e) => KA_PLACE.test(e.place || "") || KA_NAME.test(e.name || "");

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', hellip: "..." };
const decode = (s) => String(s).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&([a-z]+);/gi, (m, k) => ENT[k.toLowerCase()] ?? m);
const text = (html) => decode(String(html).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

// "16-08-2026", "16/08/2026" or "16.08.2026" -> "2026-08-16", or null
export function isoDate(s) {
  const m = String(s || "").match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (!m) return null;
  const d = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return validDay(d) ? d : null;
}
const DATE_RE = "\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{4}";
const hrefs = (html) => [...String(html).matchAll(/<a\s[^>]*href\s*=\s*["']([^"']+)["']/gi)].map((m) => decode(m[1]));
const bestLink = (list) => { for (const u of list.reverse()) { const c = cleanLink(u); if (c) return c; } return null; };

// ---- layout 1: <tr><td>name</td><td>code</td><td>start</td><td>end</td><td>place</td><td><a>brochure</a></td></tr>
function fromTable(html) {
  const rows = [];
  for (const tr of String(html).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => c[1]);
    if (cells.length < 4) continue;
    const plain = cells.map(text), di = plain.map((c, i) => (new RegExp("^" + DATE_RE + "$").test(c) ? i : -1)).filter((i) => i >= 0);
    if (!di.length) continue;                                   // the header row, or something that is not an event
    const start = isoDate(plain[di[0]]), end = di[1] != null ? isoDate(plain[di[1]]) : null;
    const code = plain.slice(0, di[0]).find((c) => /^\d{4,8}$/.test(c)) || "";
    const place = plain[(di[1] != null ? di[1] : di[0]) + 1] || "";
    rows.push({ name: plain[0], code, start, end, place, link: bestLink(hrefs(tr[1])) });
  }
  return rows;
}

// ---- layout 2: one line of text per event:  Name  [code]  DD-MM-YYYY  DD-MM-YYYY  Place  [[link]]
function fromText(html) {
  const t = decode(String(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, " $2 [[$1]] ")
    .replace(/<\/(li|p|tr|div|h\d)>|<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, " "));
  const re = new RegExp("^(.*?)\\s+(?:(\\d{4,8})\\s+)?(" + DATE_RE + ")\\s+(" + DATE_RE + ")?\\s*(.*)$");
  const rows = [];
  for (const raw of t.split("\n")) {
    const line = raw.replace(/\s+/g, " ").trim(), m = line.match(re);
    if (!m) continue;
    const links = [...line.matchAll(/\[\[([^\]]+)\]\]/g)].map((x) => x[1]);
    const place = m[5].replace(/\[\[[^\]]*\]\]/g, "").replace(/\b(download|brochure|view|pdf)\b/gi, "").replace(/\s+/g, " ").trim();
    rows.push({ name: m[1].replace(/\[\[[^\]]*\]\]/g, "").trim(), code: m[2] || "", start: isoDate(m[3]), end: m[4] ? isoDate(m[4]) : null, place, link: bestLink(links) });
  }
  return rows;
}

// All events on the page that could be read (the whole of India), cleaned. `rows` = how many rows were found before cleaning.
export function parseEvents(html) {
  let raw = fromTable(html);
  if (raw.length < MIN_ROWS) { const alt = fromText(html); if (alt.length > raw.length) raw = alt; }
  const seen = new Set(), list = [];
  for (const r of raw) { const e = cleanEvent(r); if (e && !seen.has(e.id)) { seen.add(e.id); list.push(e); } }
  return { rows: raw.length, list };
}

// Fetch + parse + keep Karnataka. Throws an Error with a plain message when the page cannot be used.
export async function fetchKarnataka({ today, fetchFn = fetch, url = SOURCE_URL } = {}) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 12000);
  let html;
  try {
    const r = await fetchFn(url, { signal: ctl.signal, headers: { "User-Agent": "ChessSathi/1.0 (academy tournament list; links back to AICF)", Accept: "text/html" } });
    if (!r.ok) throw new Error("The AICF page answered with status " + r.status + ".");
    html = await r.text();
  } catch (e) {
    throw new Error(e && e.name === "AbortError" ? "The AICF page took too long to answer." : e.message || "The AICF page could not be reached.");
  } finally { clearTimeout(timer); }
  const { rows, list } = parseEvents(html);
  if (list.length < MIN_ROWS) throw new Error("The AICF page looks different from before (" + list.length + " events could be read). The old list is kept.");
  // events that ended more than a week ago are not worth keeping
  const keep = list.filter((e) => inKarnataka(e) && (!today || e.end >= new Date(Date.parse(today + "T00:00:00Z") - 7 * 864e5).toISOString().slice(0, 10)));
  return { total: list.length, rows, list: keep.slice(0, 400) };
}
