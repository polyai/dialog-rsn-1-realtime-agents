/**
 * One agent for the whole call, the way PolyAI's own agents are built:
 *
 * - a welcome message, said word for word;
 * - a goal-and-rules prompt that stays the same all call, with the caller's number and
 *   today's date in it;
 * - high-level functions that say what to collect and enforce the rules themselves
 *   (no verified customer, no orders);
 * - always-retrieved topics, whose `actions` say which function to call;
 * - a flow step for returns, where the process needs one;
 * - a transfer to a person that ends the call, and an end_call.
 */
import { agent, tool, spoken, withKnowledge, goToStep } from "../../lib/agents.js";
import { transferCallTool, endCallTool } from "../../lib/callTools.js";
import { companyName, customers, orders, sales, policy, topics } from "./data.js";

const digits = (s) => String(s ?? "").replace(/\D/g, "");
const daysSince = (date, today) => Math.round((Date.parse(today) - Date.parse(date)) / 86_400_000);
const topic = (name) => policy.find((p) => p.name === name);

/**
 * The returns policy, in code. It decides; the agent explains. Returns the decision and the
 * policy topics it rests on.
 */
export function returnDecision({ item, order, condition, damaged_on_arrival, miles_ridden }, today) {
  const days = daysSince(order.delivered_date, today);
  const decide = (eligible, reason, names) => ({ eligible, reason, days_since_delivery: days, topics: names.map(topic) });
  if (damaged_on_arrival) {
    return days <= 60
      ? decide(true, "Arrived damaged or faulty, within 60 days of delivery. Free return or replacement.", ["damaged-on-arrival", "refund-timing"])
      : decide(false, "Damaged items must be reported within 60 days of delivery.", ["damaged-on-arrival"]);
  }
  if (days > 30) return decide(false, `Delivered ${days} days ago; the window is 30 days.`, ["returns-window"]);
  if (item.category === "helmet" && condition !== "unopened") return decide(false, "Helmets can only be returned unopened.", ["returns-condition"]);
  if (item.category === "accessory" && condition !== "unopened" && condition !== "unused") return decide(false, "Used accessories can't be returned unless faulty.", ["returns-condition"]);
  if ((item.category === "bike" || item.category === "e-bike") && !(Number(miles_ridden) < 25)) {
    return decide(false, "Bikes can be returned if ridden less than 25 miles.", ["returns-window"]);
  }
  return decide(true, "Within 30 days and in returnable condition.", ["returns-window", "refund-timing"]);
}

function findItem(phone, item_id) {
  for (const order of orders[phone] ?? []) {
    const item = order.items.find((i) => i.item_id === item_id);
    if (item) return { order, item };
  }
  return null;
}

const notVerified = { error: "not_verified", note: "Verify the caller with verify_customer first." };

export const larkspurAgent = agent({
  name: "larkspur",
  description: "A bike shop's phone line: verifies the caller, handles a return in a flow step, sells from the sale, and transfers or ends the call.",
  callerNumber: "+1 555 201 4477",
  voice: "ef191366-f52f-447a-a398-ed8c0f2943a1", // Cartesia "Archie", masculine
  welcomeMessage: `Thanks for calling ${companyName}. This call is recorded for training. How can I help?`,
  instructions: (call) => `
You're the voice assistant on ${companyName}'s phone line. ${companyName} is a bike shop that sells online and from two stores. You're relaxed, warm and patient, and you know bikes.

Your goal is to help callers with returns and exchanges, with buying something from the sale, and with questions about the shop, and to pass them to the team for anything else.

Rules:
- Verify the caller before you discuss their orders or account. verify_customer needs the phone number on the account and their date of birth.
- Order details, prices, discounts and policy come only from your tools and topics.
- One question at a time.
- The only things you can do are in your tools. Don't offer anything else, such as a callback.

Today is ${call.weekday}, ${call.today}. Caller ID shows ${call.callerNumber}. If the caller says that's the number on their account, you only need their date of birth.
`.trim(),
  knowledge: topics,
  tools: [
    tool({
      name: "verify_customer",
      description: "Check the caller's identity against their account. Call it once you have both the phone number on the account and their date of birth.",
      parameters: {
        type: "object",
        properties: {
          phone_number: { type: "string", description: "The phone number on the account, digits only." },
          date_of_birth: { type: "string", description: "YYYY-MM-DD." },
        },
        required: ["phone_number", "date_of_birth"],
      },
      execute: ({ phone_number, date_of_birth }, ctx) => {
        const phone = digits(phone_number).slice(-10);
        const c = customers.find((x) => x.phone === phone);
        if (!c || c.date_of_birth !== date_of_birth) {
          ctx.state.failures = (ctx.state.failures ?? 0) + 1;
          return { verified: false, attempts: ctx.state.failures, note: ctx.state.failures >= 2 ? "Two failed attempts: offer to transfer to the team." : "Ask the caller to check the details." };
        }
        ctx.state.customer = c;
        return { verified: true, first_name: c.first_name };
      },
    }),
    tool({
      name: "start_return",
      description: "Start a return or exchange for a verified caller.",
      execute: (_, ctx) => (ctx.state.customer ? goToStep("returns", { ok: true, orders: orders[ctx.state.customer.phone] ?? [] }) : notVerified),
    }),
    tool({
      name: "lookup_sales",
      description: "List what's on sale, with prices, optionally in one category.",
      parameters: {
        type: "object",
        properties: { category: { type: "string", enum: ["bike", "helmet", "lights", "accessory"] } },
        required: [],
      },
      execute: ({ category }) => ({ items: category ? sales.filter((s) => s.type === category) : sales }),
    }),
    tool({
      name: "send_checkout_link",
      description: "Text a verified caller a secure checkout link for items from the sale, once they've agreed the items and the total.",
      parameters: {
        type: "object",
        properties: {
          item_ids: { type: "array", items: { type: "string" } },
          utterance: spoken("A short line while it's sent, e.g. 'Sending that link now.'"),
        },
        required: ["item_ids", "utterance"],
      },
      execute: ({ item_ids }, ctx) => {
        if (!ctx.state.customer) return notVerified;
        const unknown = item_ids.filter((id) => !sales.some((s) => s.item_id === id));
        if (unknown.length) return { error: `not on sale: ${unknown.join(", ")}` };
        const total = item_ids.reduce((sum, id) => sum + sales.find((s) => s.item_id === id).sale_price_usd, 0);
        return { sent: true, total_usd: total, to: ctx.state.customer.phone, expires: "in 24 hours" };
      },
    }),
    transferCallTool({ reasons: ["SPEAK_TO", "COMPLAINT", "OUT_OF_SCOPE", "VERIFICATION_FAILED"] }),
    endCallTool(`Thanks for calling ${companyName}. Ride safe!`),
  ],
  steps: {
    returns: {
      prompt: `
The caller is verified and wants to return or exchange something. Their orders are in the start_return result.
Work out which item they mean, and confirm it with them. Find out why they're returning it and its condition, and for a bike, roughly how many miles it's done.
Then call check_return. Tell them the decision in a sentence, with the reason.
If it's eligible and they want to go ahead, call create_return. If it isn't, offer the team with transfer_call.
When the return is done or they've changed their mind, call finish_return.
`,
      tools: [
        tool({
          name: "check_return",
          description: "Check an item against the returns policy. Returns the decision and the policy it rests on.",
          parameters: {
            type: "object",
            properties: {
              item_id: { type: "string" },
              condition: { type: "string", enum: ["unopened", "unused", "used", "damaged"] },
              damaged_on_arrival: { type: "boolean" },
              miles_ridden: { type: "number", description: "Bikes and e-bikes only. Leave out otherwise." },
            },
            required: ["item_id", "condition", "damaged_on_arrival"],
          },
          execute: (args, ctx) => {
            const found = findItem(ctx.state.customer?.phone, args.item_id);
            if (!found) return { error: `no item ${args.item_id} on this customer's orders` };
            const { topics: used, ...decision } = returnDecision({ ...found, ...args }, ctx.call.today);
            ctx.state.decision = { item_id: args.item_id, ...decision };
            return withKnowledge({ item: found.item.item_name, ...decision }, used);
          },
        }),
        tool({
          name: "create_return",
          description: "Create the return for an item check_return found eligible, and text the caller the label.",
          parameters: {
            type: "object",
            properties: {
              item_id: { type: "string" },
              refund_or_exchange: { type: "string", enum: ["refund", "exchange"] },
              utterance: spoken("A short line while it's set up, e.g. 'Great, I'll set that up now.'"),
            },
            required: ["item_id", "refund_or_exchange", "utterance"],
          },
          execute: ({ item_id, refund_or_exchange }, ctx) => {
            const d = ctx.state.decision;
            if (!d || d.item_id !== item_id || !d.eligible) return { error: "not_eligible", note: "Only an item check_return found eligible can be returned." };
            return { created: true, return_id: `RT-${String(Date.now()).slice(-5)}`, refund_or_exchange, label: "texted to the caller within one hour" };
          },
        }),
        tool({
          name: "finish_return",
          description: "Leave the returns step, when the return is done or the caller wants something else.",
          execute: () => goToStep(null),
        }),
      ],
    },
  },
});

export default larkspurAgent;
