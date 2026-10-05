import { agent } from "../lib/agents.js";

export const haikuWriter = agent({
  name: "haikuWriter",
  handoffDescription: "Writes haikus.",
  instructions: "Ask the caller for a topic if they haven't given one, then reply with a haiku about it. Say only the haiku, with no title.",
});

export const greeter = agent({
  name: "greeter",
  handoffDescription: "Greets the caller.",
  instructions: "Greet the caller and ask if they'd like a haiku. If they say yes, transfer them to haikuWriter. Don't write haikus yourself.",
  handoffs: [haikuWriter],
});

export default [greeter, haikuWriter];
