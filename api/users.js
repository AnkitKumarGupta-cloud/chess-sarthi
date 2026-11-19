import { handler, HttpError, whoIs, mustBeTeacher, kv, kvPipe, getUser, putUser, listUsers, seenTimes, hashPassword, newPassword, slug, normUser, validUsername, RESERVED, cfg } from "./_lib.js";

async function freeUsername(base) {
  let u = base.slice(0, 24);
  if (u.length < 3) u = (u + "student").slice(0, 12);
  for (let i = 0; i < 20; i++) {
    const t = i === 0 ? u : u + Math.floor(10 + Math.random() * 89);
    if (validUsername(t) && !RESERVED.includes(t) && !(await getUser(t))) return t;
  }
  throw new HttpError(500, "Could not make a username. Please try another name.");
}
async function create(role, name, batch, base, child) {
  const username = await freeUsername(base), pw = newPassword();
  await putUser({ username, name, role, batch: slug(batch), batchName: batch, pw: hashPassword(pw), createdAt: Date.now(), ...(child ? { child } : {}) });
  return { username, password: pw, role, name, batch, ...(child ? { child } : {}) };
}
// A parent account belongs to exactly one child and sees only that child (progress, streak, weak themes, class schedule).
const MAX_PARENTS = 2;
async function addParent(student) {
  const kids = (await listUsers()).filter((u) => u.role === "parent" && u.child === student.username);
  if (kids.length >= MAX_PARENTS) throw new HttpError(400, `${student.name} already has ${MAX_PARENTS} parent logins.`);
  return create("parent", student.name, student.batchName || student.batch || "", slug(student.name).replace(/-/g, "").slice(0, 14) + "parent", student.username);
}

// Teacher only: list accounts, add a student, reset a password, delete an account.
export default handler(async ({ req, body, query }) => {
  mustBeTeacher(await whoIs(req));
  if (req.method === "GET") { const users = await listUsers(), seen = await seenTimes(users.map((u) => u.username)); return { users: users.map((u, i) => ({ ...u, seen: seen[i] })), demo: cfg().demoPassword ? { username: "demo", password: cfg().demoPassword } : null }; }
  if (req.method === "DELETE") {
    const u = normUser(query.username);
    const rec = await getUser(u);
    if (!rec) throw new HttpError(404, "That account was not found.");
    const cmds = [["DEL", "u:" + u], ["SREM", "users", u], ["DEL", "p:" + u], ["DEL", "ps:" + u], ["DEL", "seen:" + u], ["DEL", "at:" + u], ["DEL", "g:" + u], ["DEL", "reset:" + u]];
    // A parent login is useless without its child, so it goes too (and takes nothing else: parents hold no data of their own)
    if (rec.role === "student") for (const x of await listUsers()) if (x.role === "parent" && x.child === u) cmds.push(["DEL", "u:" + x.username], ["SREM", "users", x.username], ["DEL", "seen:" + x.username]);
    await kvPipe(cmds);
    return { ok: true };
  }
  if (req.method !== "POST") throw new HttpError(405, "Use GET, POST or DELETE.");
  if (body.action === "reset") {
    const rec = await getUser(body.username);
    if (!rec) throw new HttpError(404, "That account was not found.");
    const pw = newPassword(); rec.pw = hashPassword(pw); await putUser(rec);
    return { username: rec.username, password: pw, role: rec.role, name: rec.name, batch: rec.batchName };
  }
  if (body.action === "addParent") {
    const st = await getUser(body.username);
    if (!st || st.role !== "student") throw new HttpError(404, "Pick a student to add a parent login for.");
    return { accounts: [await addParent(st)] };
  }
  const name = String(body.name || "").trim().slice(0, 40), batch = String(body.batch || "").trim().slice(0, 40);
  if (!name || !slug(batch)) throw new HttpError(400, "Please enter the student's name and the batch.");
  const base = slug(name).replace(/-/g, "");
  const student = await create("student", name, batch, base);
  const accounts = [student];
  if (body.withParent) accounts.push(await addParent({ username: student.username, name, batch: slug(batch), batchName: batch }));
  return { accounts };
}, { needs: ["base", "db"] });
