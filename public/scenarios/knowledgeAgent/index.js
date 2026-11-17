import { agent, tool, spoken, withKnowledge } from "../../lib/agents.js";
import { transferCallTool, endCallTool } from "../../lib/callTools.js";
import { companyName, brief, articles } from "./articles.js";

const STOP = new Set(["the", "and", "for", "you", "your", "how", "what", "can", "does", "with", "my", "is", "do", "i", "a", "to", "of", "on", "in", "it"]);
const words = (s) => String(s).toLowerCase().split(/\W+/).filter((w) => w.length > 2 && !STOP.has(w));

/** A keyword search over the help center. Swap in your own search: vector, BM25, an API. */
export function searchArticles(query, limit = 3) {
  const q = words(query);
  return articles
    .map((a) => {
      const text = words(`${a.title} ${a.title} ${a.content}`);
      return { a, score: q.reduce((n, w) => n + text.filter((t) => t.startsWith(w) || w.startsWith(t)).length, 0) };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map((x) => x.a);
}

// What poly_knowledge takes: name and content, and actions where a topic has them.
const asTopic = ({ name, content, actions }) => (actions ? { name, content, actions } : { name, content });

export const helpCenterAgent = agent({
  name: "helpCenter",
  description: "An energy supplier's help line that answers from its help center and takes meter readings.",
  callerNumber: "+1 503 555 0164",
  welcomeMessage: `Hi, you're through to ${companyName}. What can I help with today?`,
  instructions: (call) => `
You answer the phone for ${companyName}'s customer help line. You're warm, clear and efficient.

Your goal is to answer the caller's questions from the help center, take a meter reading if they want to give one, and get them to the customer team for anything you can't do.

Rules:
- You can't see or change accounts. For anything that needs one, transfer the caller, or book a callback if they'd rather.
- If the help center doesn't cover a question about ${companyName}, say you don't have that information, and offer a callback.
- One question at a time.

Today is ${call.weekday}, ${call.today}. The caller is ringing from ${call.callerNumber}.
`.trim(),
  knowledge: brief.map(asTopic),
  tools: [
    tool({
      name: "searchHelpCenter",
      description: "Search the help center for anything about bills, meters, tariffs, payments, moving home or Quillon's services. The best matching articles come back as knowledge.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "What the caller wants to know, in a few words." } },
        required: ["query"],
      },
      execute: ({ query }) => {
        const found = searchArticles(query);
        // The output says what was found; the articles themselves ride along as poly_knowledge.
        return withKnowledge({ found: found.length, articles: found.map((a) => a.title) }, found.map(asTopic));
      },
    }),
    tool({
      name: "submitMeterReading",
      description: "Record a meter reading for the caller's account, found from the number they're calling from.",
      parameters: {
        type: "object",
        properties: {
          meter: { type: "string", enum: ["electricity", "gas"] },
          reading: { type: "string", description: "The digits on the meter, as the caller read them, digits only." },
          utterance: spoken("A short line while you record it, e.g. 'Thanks, I'll put that in now.'"),
        },
        required: ["meter", "reading", "utterance"],
      },
      execute: ({ meter, reading }, ctx) => {
        const digits = String(reading).replace(/\D/g, "");
        if (digits.length < 4 || digits.length > 6) return { saved: false, error: `a ${meter} reading has 4 to 6 digits; got ${digits.length}` };
        return { saved: true, meter, reading: digits, account_phone: ctx.call.callerNumber, used_on: "the next bill" };
      },
    }),
    tool({
      name: "requestCallback",
      description: "Book a callback from the customer team, for something the help center can't answer or that needs their account.",
      parameters: {
        type: "object",
        properties: {
          phone_number: { type: "string", description: "The number to call back, digits only. The caller's own number unless they give another." },
          topic: { type: "string" },
          preferred_time: { type: "string", description: "e.g. 'tomorrow morning'." },
        },
        required: ["phone_number", "topic"],
      },
      execute: ({ phone_number, topic, preferred_time }) => ({
        booked: true,
        reference: `QB-${String(Date.now()).slice(-5)}`,
        phone_number,
        topic,
        when: preferred_time || "within one business day",
      }),
    }),
    transferCallTool({ reasons: ["SPEAK_TO", "ACCOUNT_CHANGE", "COMPLAINT", "OUT_OF_SCOPE"] }),
    endCallTool(`Thanks for calling ${companyName}. Have a good day.`),
  ],
});

export default [helpCenterAgent];
