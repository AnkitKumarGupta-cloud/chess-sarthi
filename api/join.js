import crypto from "node:crypto";
import { handler, HttpError, whoIs, getClassFor, joinToken, lkServerUrl } from "./_lib.js";
// Students and the teacher get a ticket into the classroom. Parents watch recordings only.
export default handler(async ({ req, body }) => {
  if (req.method !== "POST") throw new HttpError(405, "Use POST.");
  const me = await whoIs(req);
  if (me.role === "parent") throw new HttpError(403, "Parents can watch recordings, but only students and the teacher can join the live class.");
  const cls = await getClassFor(me, body.classId);
  let who = me;
  // Many people share one demo login, so each one types a name and gets their own identity in the room.
  if (me.role === "demo") {
    const name = String(body.name || "").replace(/\s+/g, " ").trim().slice(0, 30);
    if (name.length < 2) throw new HttpError(400, "Please type your name to join the class.", "name");
    who = { ...me, id: "demo-" + crypto.randomBytes(5).toString("hex"), name: name + " (demo)" };
  }
  return { serverUrl: lkServerUrl(), token: joinToken(who, cls), userName: who.name, userId: who.id, isTeacher: me.role === "teacher", title: cls.title };
}, { needs: ["base", "db", "live"] });
