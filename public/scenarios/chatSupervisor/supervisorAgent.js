import { tool, spoken, withKnowledge } from "../../lib/agents.js";
import { runTextAgent } from "../../lib/textAgent.js";
import { companyName, accounts, policyDocs, stores } from "./sampleData.js";

const digits = (s) => String(s ?? "").replace(/\D/g, "");

// The supervisor is your text agent: its instructions and tools are what you'd give a chat
// deployment. It never talks to the caller. It writes the voice agent's next message.
export const supervisorAgentInstructions = `You are an expert customer service supervisor for ${companyName}. A junior agent is on a voice call with a customer and asks you what to say next. You get the conversation so far and the junior agent's notes. Write the junior agent's next message, which they will read out word for word.

# Instructions
- Call a tool before answering any factual question about ${companyName}, its plans and offers, or the customer's account. Answer only from what the tools return, never from your own knowledge.
- If a tool needs information the customer hasn't given, like their phone number or zip code, your message should ask for it. Never call a tool with a missing or made-up value.
- If you can't do what they ask with your tools, say so politely and offer to find their nearest store.
- Don't discuss politics, religion, medical, legal or financial advice, or anything unrelated to their phone service.

# The message you write
- It's spoken aloud, so plain prose: no lists, markdown, symbols or citations.
- Two or three short sentences at most. Give the most important numbers and summarise the rest.
- Write only the message, nothing before or after it.`;

export const supervisorAgentTools = [
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
 * The voice agent's one tool. It writes a short filler line, which the caller hears while
 * the supervisor works, and the supervisor's answer comes back as the tool's output.
 */
export const getNextResponseFromSupervisor = tool({
  name: "getNextResponseFromSupervisor",
  description: "Ask your supervisor what to say next. They have the full conversation, the company's tools and policies.",
  parameters: {
    type: "object",
    properties: {
      relevantContextFromLastUserMessage: {
        type: "string",
        description: "Key information from the caller's last message, as the supervisor may not have it yet. Can be empty.",
      },
      filler: spoken("A short neutral phrase to say while you check, like 'One moment.' or 'Let me look into that.' It must not hint at the answer."),
    },
    required: ["relevantContextFromLastUserMessage", "filler"],
  },
  execute: async ({ relevantContextFromLastUserMessage }, ctx) => {
    const nextResponse = await runTextAgent({
      connect: ctx.connect,
      onSession: ctx.onSession,
      label: "supervisor",
      instructions: supervisorAgentInstructions,
      tools: supervisorAgentTools,
      input: `==== Conversation so far ====
${ctx.history.map((m) => `${m.role === "user" ? "customer" : "junior agent"}: ${m.text}`).join("\n")}

==== Junior agent's notes on the last message ====
${relevantContextFromLastUserMessage || "(none)"}`,
      ctx,
    });
    return { nextResponse };
  },
});
