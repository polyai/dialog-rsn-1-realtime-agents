import { agent, tool, spoken, withKnowledge } from "../../lib/agents.js";
import { runTextAgent } from "../../lib/textAgent.js";
import { companyName, orders, policy } from "./data.js";

const digits = (s) => String(s ?? "").replace(/\D/g, "");

export const returnsAgent = agent({
  name: "returns",
  handoffDescription: "Handles returns, refunds and damaged deliveries for verified customers.",
  instructions: `
# Personality and tone
You handle returns at ${companyName}. Calm, kind and practical: people calling about returns are often a little frustrated, so acknowledge that briefly and then get on with helping. Short spoken sentences. Never use lists, markdown or symbols.

# Task
Help a verified caller return an item, from finding the order to a decision.

# Steps
1. Greet the caller as the returns team. The caller has already been verified; their phone number is in the conversation.
2. Call lookup_orders with their phone number. Say which order and item you think they mean, and confirm it with them.
3. Ask why they're returning it and what condition it's in, if they haven't said.
4. Call retrieve_policy for the item's category, and tell them in a sentence whether it looks eligible.
5. Call check_eligibility for the decision. It can take a few seconds.
6. Tell them the decision and, if it's approved, what happens next.

# Rules
- Order details, prices and policy come only from your tools. Never quote a figure from memory.
- Don't approve or deny a return yourself. check_eligibility decides.
- If they want to buy something instead, transfer them to sales. If they're upset or ask for a person, transfer them to simulatedHuman.
`.trim(),
  tools: [
    tool({
      name: "lookup_orders",
      description: "Find the caller's recent orders by their phone number.",
      parameters: {
        type: "object",
        properties: {
          phone_number: { type: "string", description: "The caller's phone number, digits only." },
          utterance: spoken("A short line while you look, e.g. 'Let me find your orders.'"),
        },
        required: ["phone_number", "utterance"],
      },
      execute: ({ phone_number }) => {
        const key = Object.keys(orders).find((k) => digits(phone_number).endsWith(k));
        return key ? { orders: orders[key] } : { orders: [], note: "No orders found for that number." };
      },
    }),
    tool({
      name: "retrieve_policy",
      description: "Get the returns policy that applies to an item. The policy comes back as knowledge you can answer from.",
      parameters: {
        type: "object",
        properties: { item_category: { type: "string", description: "The item's category, e.g. bike, e-bike, helmet, accessory." } },
        required: ["item_category"],
      },
      execute: () => withKnowledge({ topics: policy.map((p) => p.name) }, policy),
    }),
    tool({
      name: "check_eligibility",
      description: "Decide whether a return is allowed under the policy and, if it is, start it. A careful reviewer reads the conversation, so give only the key facts.",
      parameters: {
        type: "object",
        properties: {
          order_id: { type: "string" },
          item_id: { type: "string" },
          user_desired_action: { type: "string", description: "What the caller wants, e.g. 'return for a refund'." },
          question: { type: "string", description: "What you'd like the reviewer to decide." },
          utterance: spoken("A short line while it's checked, e.g. 'I'll run that past our returns policy, it takes a moment.'"),
        },
        required: ["order_id", "item_id", "user_desired_action", "question", "utterance"],
      },
      execute: async (args, ctx) => {
        // A high-stakes decision gets a second, careful look: the same model, on its own text
        // session, with the full policy and the conversation, and nothing to do but decide.
        ctx.breadcrumb?.("[returns] asking the eligibility reviewer", args);
        const order = Object.values(orders).flat().find((o) => o.order_id === args.order_id);
        const verdict = await runTextAgent({
          connect: ctx.connect,
          onSession: ctx.onSession,
          label: "reviewer",
          instructions: `You decide return requests for ${companyName} strictly by the policy below. You are careful and fair. Today's date is ${new Date().toISOString().slice(0, 10)}.

Policy:
${policy.map((p) => `- ${p.name}: ${p.content}`).join("\n")}

Reply in exactly this format:
Eligible: yes, no, or need_more_information
Reason: one sentence citing the policy.
Missing information: what you'd need to know, or none.
Next steps: if eligible, what the customer receives and when; otherwise none.`,
          input: `Request: ${args.user_desired_action}
Question: ${args.question}
Order: ${JSON.stringify(order ?? { order_id: args.order_id, note: "not found" })}
Item: ${args.item_id}

Conversation so far:
${ctx.history.map((m) => `${m.role}: ${m.text}`).join("\n")}`,
          ctx,
        });
        ctx.breadcrumb?.("[returns] reviewer's decision", { verdict });
        return { decision: verdict };
      },
    }),
  ],
});
