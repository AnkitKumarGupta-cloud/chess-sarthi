import { handler, HttpError, checkLogin, sessionToken, markSeen } from "./_lib.js";
export default handler(async ({ req, body }) => {
  if (req.method !== "POST") throw new HttpError(405, "Use POST.");
  const user = await checkLogin(body.username, body.password);
  await markSeen(user);
  return { token: sessionToken(user), user };
});
