/**
 * Handoffs between agents, as openai/openai-realtime-agents builds them. This is here for
 * developers moving from that repo: it's how their simpleHandoff scenario looks on
 * Dialog-RSN-1.
 *
 * It isn't how to build an agent on Dialog-RSN-1. A handoff replaces the system prompt and
 * tools mid-call. The system prompt comes before the history, so the server can't reuse
 * what it had already processed, and reads the whole conversation again at every handoff.
 * Build one agent, with flow steps where a process needs them: see bikeShop/.
 */
import { agent } from "../lib/agents.js";

export const haikuWriter = agent({
  name: "haikuWriter",
  description: "Writes haikus.",
  instructions: "Ask the caller for a topic if they haven't given one, then reply with a haiku about it. Say only the haiku, with no title.",
});

export const greeter = agent({
  name: "greeter",
  description: "Greets the caller and hands them to the haiku writer.",
  welcomeMessage: "Hi there! Would you like a haiku?",
  instructions: "You've asked the caller if they'd like a haiku. If they say yes, transfer them to haikuWriter. Don't write haikus yourself.",
  handoffs: [haikuWriter],
});

export default [greeter, haikuWriter];
