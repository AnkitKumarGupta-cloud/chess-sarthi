// Local preview with a FAKE AI provider too, to try Sathi without an API key:  node test/dev-ai.mjs
import { useEnv } from "./fakes.mjs";
useEnv({ GROQ_API_KEY: "fake" });
const prev = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes("api.groq.com")) {
    const user = JSON.parse(opts.body).messages[1].content;
    const facts = (user.match(/(The student just played[^\n]*|Stockfish says[^\n]*)/g) || []).join(" ");
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "FAKE AI: " + (facts || "I am not sure about that.") } }] }) };
  }
  return prev(url, opts);
};
await import("./dev-server.mjs");
