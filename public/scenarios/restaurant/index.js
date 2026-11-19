/**
 * Margaux, who answers the phone at Maison Lumiere: the restaurant from the playground on
 * poly.ai, with the PolyAI features a production agent uses.
 *
 * - a welcome message, said word for word (`poly_first_assistant_message`);
 * - always-retrieved topics whose `actions` say what to do, and a search tool that returns
 *   the guide's longer sections as `poly_knowledge` on its output. The page shows the topics
 *   each answer cites (`poly_cited_topics`);
 * - a booking read back before it's made, with a line said while it's written (`poly_spoken`);
 * - `hold`, which says one line and then nothing more while the caller checks with someone;
 * - `switch_language`, which sets `poly_response_language`;
 * - a transfer to a person, and an end_call.
 */
import { agent, tool, spoken, withKnowledge, quiet, setSession } from "../../lib/agents.js";
import { transferCallTool, endCallTool } from "../../lib/callTools.js";
import { keywordSearch, asTopic } from "../../lib/search.js";
import { restaurantName, always, guide } from "./knowledge.js";
import { checkAvailability, createBooking } from "./tables.js";

// What switch_language sets as poly_response_language. The page's voice follows it.
const LANGUAGES = { English: "en-GB", French: "fr-FR" };

const DAY = { type: "string", description: "ISO date, e.g. 2026-09-04" };
const TIME = { type: "string", description: "24-hour local time, e.g. 19:30" };
const PARTY = { type: "integer", minimum: 1, maximum: 20 };
const AREA = { type: "string", enum: ["main", "terrace", "bar"] };

// The coming week spelled out, so "this Friday" isn't left to date arithmetic.
function week(today) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i + 1);
    return `${d.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" })} ${d.toISOString().slice(0, 10)}`;
  }).join(", ");
}

export const margaux = agent({
  name: "margaux",
  description: "A restaurant's phone line: answers from its guide, books tables, holds while the caller checks with friends, speaks French on request.",
  callerNumber: "+44 20 7946 0321",
  voice: "25d7abcb-4d6d-4aca-adce-8a1c85620c8b", // Cartesia "Jessica", feminine, as in the poly.ai playground
  welcomeMessage: `${restaurantName}, this is Margaux. How can I help?`,
  instructions: (call) => `
You are Margaux, who answers the phone at ${restaurantName}, an upscale French-Japanese restaurant in Kensington. You're warm and polished, and you keep each reply to one to three short sentences.

Your goal is to book tables and answer questions about the menus, drinks, dietary needs and the restaurant, and to put guests through to the team for anything else.

Rules:
- Your topics cover the basics. For the menus, wines, sake, cocktails or the staff, call search_guide.
- For anything you can't answer or do yourself, offer to put the guest through to the team, and if they agree, call transfer_call. Don't offer the restaurant's number instead.
- Never invent availability: call check_availability before you offer a time, and offer only what it returns.
- Ask where they'd like to sit only if it matters, such as the bar for a party of two. Otherwise any free area will do.
- Before create_booking, read the details back in one sentence (day, time, party size and name) and book once the guest agrees. Then give the reference from what create_booking returned, letter by letter and digit by digit.
- Guests are often booking a celebration: when they mention one, be glad for them and put it in the notes.
- Never call the guest by their surname. A first name, sparingly, is fine.

If the guest asks you to hold on while they check with someone, call hold with a short reply such as "Of course, take your time."

You speak English and French. If the guest speaks French, or asks for it, call switch_language.

Today is ${call.weekday}, ${call.today}. The coming week: ${week(call.today)}. "Friday" means the next Friday in that list.
`.trim(),
  knowledge: always.map(asTopic),
  tools: [
    tool({
      name: "search_guide",
      description: "Search the restaurant's guide: the two tasting menus, the wine list, sake and spirits, cocktails, and the chefs and sommeliers. The best matching sections come back as knowledge.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "What the guest wants to know, in a few English words, whatever language the call is in." } },
        required: ["query"],
      },
      execute: ({ query }) => {
        const found = keywordSearch(guide, query);
        return withKnowledge({ found: found.length, sections: found.map((t) => t.name) }, found.map(asTopic));
      },
    }),
    tool({
      name: "check_availability",
      description: "Look for open tables for a day, time and party size.",
      parameters: {
        type: "object",
        properties: { day: DAY, time: TIME, party_size: PARTY, area: { ...AREA, description: "Only if the guest asked for one." } },
        required: ["day", "time", "party_size"],
      },
      execute: (args, ctx) => checkAvailability((ctx.state.book ??= []), args, ctx.call.today),
    }),
    tool({
      name: "create_booking",
      description: "Write the booking the guest agreed to, and get a reference to read back.",
      parameters: {
        type: "object",
        properties: {
          utterance: spoken("A short line while you book, e.g. 'Lovely, I'll get that booked in.'"),
          name: { type: "string", description: "The guest's name for the booking, spelled as they spelled it." },
          day: DAY,
          time: TIME,
          party_size: PARTY,
          area: { ...AREA, description: "Where the guest asked to sit, if they did." },
          notes: { type: "string", description: "Occasions, requests and dietary needs, free text." },
        },
        required: ["utterance", "name", "day", "time", "party_size"],
      },
      execute: (args, ctx) => {
        const result = createBooking((ctx.state.book ??= []), args, ctx.call.today);
        if (result.booked) ctx.breadcrumb(`Booked ${result.reference}`, result);
        return result;
      },
    }),
    tool({
      name: "hold",
      description: "The guest asked you to hold on while they check with someone. Say a short line and wait for them to come back.",
      parameters: {
        type: "object",
        properties: { utterance: spoken("A short reply, e.g. 'Of course, take your time.'") },
        required: ["utterance"],
      },
      execute: (_, ctx) => {
        ctx.breadcrumb("On hold");
        return quiet({ on_hold: true, note: "Say nothing more until the guest talks to you again." });
      },
    }),
    tool({
      name: "switch_language",
      description: "Switch the language you speak to the guest.",
      parameters: {
        type: "object",
        properties: { language: { type: "string", enum: Object.keys(LANGUAGES) } },
        required: ["language"],
      },
      execute: ({ language }, ctx) => {
        if (!LANGUAGES[language]) return { error: `no language '${language}'` };
        ctx.breadcrumb(`Language: ${language}`);
        return setSession({ poly_response_language: LANGUAGES[language] }, { language });
      },
    }),
    transferCallTool({ reasons: ["EVENTS", "CHANGE_BOOKING", "QUESTION", "SPEAK_TO", "COMPLAINT"] }),
    endCallTool(`Thank you for calling ${restaurantName}. Have a lovely evening.`),
  ],
});

export default margaux;
