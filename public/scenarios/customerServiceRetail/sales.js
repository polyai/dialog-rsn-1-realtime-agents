import { agent, tool, spoken } from "../../lib/agents.js";
import { companyName, sales } from "./data.js";

export const salesAgent = agent({
  name: "sales",
  handoffDescription: "Helps verified customers find a bike or gear, including what's on sale, and check out.",
  instructions: `
# Personality and tone
You're on the sales team at ${companyName}. Friendly and knowledgeable, never pushy: you'd rather someone buys the right bike than an expensive one. Short spoken sentences, no lists, markdown or symbols. When you mention several items, name two or three at most and ask which interests them.

# Task
Help the caller find something they'll love, add it to their cart and check out.

# Rules
- Prices and discounts come only from lookup_sales. Never quote one from memory.
- Ask one question at a time about what they need: the kind of riding, budget, or size.
- Before checkout, read back the items and the total and get a yes.
- For returns, transfer to returns. If they ask for a person, transfer to simulatedHuman.
`.trim(),
  tools: [
    tool({
      name: "lookup_sales",
      description: "List what's on sale, optionally in one category.",
      parameters: {
        type: "object",
        properties: { category: { type: "string", description: "bike, helmet, lights or accessory. Leave empty for everything." } },
        required: [],
      },
      execute: ({ category }) => ({ items: category ? sales.filter((s) => s.type === category) : sales }),
    }),
    tool({
      name: "add_to_cart",
      description: "Add an item to the caller's cart.",
      parameters: { type: "object", properties: { item_id: { type: "string" } }, required: ["item_id"] },
      execute: ({ item_id }) => (sales.some((s) => s.item_id === item_id) ? { added: item_id } : { error: `no item ${item_id}` }),
    }),
    tool({
      name: "checkout",
      description: "Send the caller a secure checkout link by text once they've agreed the items and total.",
      parameters: {
        type: "object",
        properties: {
          item_ids: { type: "array", items: { type: "string" } },
          phone_number: { type: "string", description: "The caller's verified phone number." },
          utterance: spoken("A short line while it's sent, e.g. 'Sending that link now.'"),
        },
        required: ["item_ids", "phone_number", "utterance"],
      },
      execute: ({ item_ids }) => {
        const total = item_ids.reduce((sum, id) => sum + (sales.find((s) => s.item_id === id)?.sale_price_usd ?? 0), 0);
        return { sent: true, total_usd: total, note: "Checkout link texted to the caller. It expires in 24 hours." };
      },
    }),
  ],
});
