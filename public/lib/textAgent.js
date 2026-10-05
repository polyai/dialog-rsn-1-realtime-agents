/**
 * A one-off text conversation with Dialog-RSN-1 on a second session: give it instructions,
 * tools and one message, let it call tools until it answers, and return the answer.
 *
 * The chat supervisor uses this to work out what the voice agent should say, and the
 * returns agent uses it for a careful second look at an eligibility decision. It's the same
 * model as the voice session, used as a text agent.
 */
import { RealtimeSession } from "./session.js";
import { asToolResult } from "./agents.js";

export async function runTextAgent(opts) {
  // A connection that stalls is retried once on a fresh socket.
  try {
    return await attempt(opts);
  } catch (err) {
    if (!/no session|connection closed|could not connect/.test(err.message)) throw err;
    opts.ctx?.breadcrumb?.(`[${opts.label ?? "supervisor"}] connecting again (${err.message})`);
    return attempt(opts);
  }
}

async function attempt({ connect, label = "supervisor", instructions, tools = [], input, ctx = {}, onSession, timeoutMs = 30_000 }) {
  const session = new RealtimeSession({
    label,
    connect,
    async onToolCall(call) {
      const t = tools.find((x) => x.name === call.name);
      if (!t) return { output: { error: `unknown tool '${call.name}'` } };
      const result = asToolResult(await t.execute(call.args ?? {}, ctx));
      ctx.breadcrumb?.(`[${label}] ${call.name}`, { arguments: call.args, ...result });
      return result;
    },
  });
  onSession?.(session); // lets the page show this session's events in the log

  const texts = new Map();
  session.on("agent.done", ({ responseId, text }) => texts.set(responseId, text));

  try {
    await session.connect({
      type: "realtime",
      output_modalities: ["text"],
      instructions,
      tools: tools.map(({ name, description, parameters }) => ({ type: "function", name, description, parameters })),
    });
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} took longer than ${timeoutMs / 1000} s`)), timeoutMs);
      session.on("response.done", ({ response }) => {
        if (response.status !== "completed") {
          clearTimeout(timer);
          reject(new Error(`${label} response ${response.status}`));
        } else if (!(response.output ?? []).some((o) => o.type === "function_call")) {
          // No more tools to run: this is the answer.
          clearTimeout(timer);
          resolve(texts.get(response.id) ?? "");
        }
      });
      session.sendText(input);
    });
  } finally {
    session.close();
  }
}
