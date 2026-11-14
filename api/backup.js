import { handler, whoIs, mustBeTeacher, kv } from "./_lib.js";

// Teacher only: one JSON file with everything in the database (accounts, classes, recordings list,
// every student's progress), so the teacher can keep their own copy. Passwords are stored hashed.
export default handler(async ({ req }) => {
  mustBeTeacher(await whoIs(req));
  const users = (await kv("SMEMBERS", "users")) || [], classes = (await kv("SMEMBERS", "classes")) || [];
  const keys = [
    ...users.flatMap((u) => ["u:" + u, "p:" + u, "ps:" + u]),
    ...classes.flatMap((c) => ["c:" + c, "r:" + c]),
  ];
  const data = {};
  if (keys.length) {
    const vals = await kv("MGET", ...keys);
    keys.forEach((k, i) => { if (vals[i] != null) data[k] = vals[i]; });
  }
  return { app: "chess-sathi", version: 1, createdAt: new Date().toISOString(), sets: { users, classes }, data };
}, { needs: ["base", "db"] });
