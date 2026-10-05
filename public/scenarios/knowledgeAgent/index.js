import { agent, tool, spoken, withKnowledge } from "../../lib/agents.js";
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

export const helpCenterAgent = agent({
  name: "helpCenter",
  handoffDescription: "Answers questions about bills, meters, tariffs and moving home from the help center.",
  instructions: `
You answer the phone for ${companyName}'s customer help line. Warm, clear and efficient. Short spoken sentences, no lists, markdown or URLs.

# How you answer
- Greet a new caller with: "Hi, you're through to ${companyName}. What can I help with today?"
- For any question about bills, meters, tariffs, payments, moving or anything else about ${companyName}, call searchHelpCenter first, then answer only from what it returns and the brief you were given. Never answer from your own knowledge.
- If the help center doesn't cover it, say you don't have that information and offer a callback from the team with requestCallback.
- If someone mentions a gas smell or any danger, give the emergency number from your brief straight away, before anything else.
- You can't see accounts or make changes. If they need that, offer a callback.
`.trim(),
  knowledge: brief,
  tools: [
    tool({
      name: "searchHelpCenter",
      description: "Search the help center. The best matching articles come back as knowledge you can answer from.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What the caller wants to know, in a few words." },
          utterance: spoken("A short line while you look, e.g. 'Let me check that for you.'"),
        },
        required: ["query", "utterance"],
      },
      execute: ({ query }) => {
        const found = searchArticles(query);
        // The output says what was found; the articles themselves ride along as poly_knowledge.
        return withKnowledge(
          { found: found.length, articles: found.map((a) => a.title) },
          found.map((a) => ({ name: a.name, content: a.content })),
        );
      },
    }),
    tool({
      name: "requestCallback",
      description: "Book a callback from the customer team for something the help center can't answer or that needs their account.",
      parameters: {
        type: "object",
        properties: {
          phone_number: { type: "string", description: "Confirmed with the caller, digits only." },
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
  ],
});

export default [helpCenterAgent];
