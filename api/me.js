import { handler, whoIs, publicUser, markSeen } from "./_lib.js";
// Called once each time the app opens, so this is also where "last opened" is recorded.
export default handler(async ({ req }) => { const me = await whoIs(req); await markSeen(me); return { user: publicUser(me) }; });
