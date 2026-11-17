/**
 * Your existing text agent: the prompt and tools of a chat deployment you already run,
 * unchanged. The voice agent asks it for an answer whenever a question needs it, and says
 * the answer to the caller.
 *
 * Here the text agent is Dialog-RSN-1 on a second session, in text, so the example runs with
 * one key. In your own app, `ask_text_agent` would call whatever you run today: your chat
 * agent's API, an agent framework, a workflow.
 */
import { tool, spoken, withKnowledge } from "../../lib/agents.js";
import { runTextAgent } from "../../lib/textAgent.js";
import { companyName, accounts, policyDocs, stores } from "./sampleData.js";

const digits = (s) => String(s ?? "").replace(/\D/g, "");

export const textAgentInstructions = `You are ${companyName}'s customer support chat agent. Answer the customer's latest request, using your tools for anything about plans, offers, prices or their account.

- If a tool needs something the customer hasn't given, like their phone number or zip code, ask for it. Never call a tool with a missing or made-up value.
- If you can't do what they ask, say so, and offer to find their nearest store.
- Stay on the subject of ${companyName} and their phone service.

Your reply is read aloud to the customer on a phone call, so write plain prose in two or three short sentences, with the most important numbers first.`;

export const textAgentTools = [
  tool({
    name: "lookupPolicyDocument",
    description: "Look up company policy, plans and offers by topic or keyword. The documents come back as knowledge.",
    parameters: { type: "object", properties: { topic: { type: "string", description: "e.g. 'family plan', 'international calls'." } }, required: ["topic"] },
    execute: ({ topic }) => {
      const words = String(topic).toLowerCase().split(/\W+/).filter((w) => w.length > 2);
      const hits = policyDocs.filter((d) => words.some((w) => (d.name + " " + d.content).toLowerCase().includes(w)));
      const found = hits.length ? hits : policyDocs;
      return withKnowledge({ documents: found.map((d) => d.name) }, found);
    },
  }),
  tool({
    name: "getUserAccountInfo",
    description: "Get the customer's account and latest bill. Needs their phone number.",
    parameters: { type: "object", properties: { phone_number: { type: "string", description: "Digits only." } }, required: ["phone_number"] },
    execute: ({ phone_number }) => accounts.find((a) => digits(phone_number).endsWith(a.phone)) ?? { error: "No account found for that number." },
  }),
  tool({
    name: "findNearestStore",
    description: "Find the nearest store by zip code.",
    parameters: { type: "object", properties: { zip_code: { type: "string" } }, required: ["zip_code"] },
    execute: ({ zip_code }) => {
      const z = Number(digits(zip_code));
      return { stores: [...stores].sort((a, b) => Math.abs(Number(a.zip) - z) - Math.abs(Number(b.zip) - z)).slice(0, 2) };
    },
  }),
];

/**
 * The voice agent's bridge to your text agent. Each ask runs at least two generations on
 * another session, so it's slow: the `filler` argument is said while it runs.
 */
export const askTextAgent = tool({
  name: "ask_text_agent",
  description: "Get the answer to a question about plans, offers, prices, bills or the caller's account from the support system. It has the conversation so far.",
  parameters: {
    type: "object",
    properties: {
      request: { type: "string", description: "What the caller wants, with any details they've given, such as their phone number." },
      filler: spoken("A short neutral line while you check, like 'Let me look into that.' It mustn't hint at the answer."),
    },
    required: ["request", "filler"],
  },
  execute: async ({ request }, ctx) => {
    const answer = await runTextAgent({
      connect: ctx.connect,
      onSession: ctx.onSession,
      label: "text agent",
      instructions: textAgentInstructions,
      tools: textAgentTools,
      // The text agent gets the transcript of the call so far, as a chat history would.
      input: `Conversation so far:
${ctx.history.map((m) => `${m.role === "user" ? "customer" : "agent"}: ${m.text}`).join("\n")}

Latest request: ${request}`,
      ctx,
    });
    return { answer };
  },
});
