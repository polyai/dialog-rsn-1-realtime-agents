---
name: new-scenario
description: Write a new Dialog-RSN-1 voice agent scenario for this repo (one agent with a welcome message, a goal-and-rules prompt, high-level functions, topics, flow steps where needed, test data and a check journey) from a description of the business. Use when asked to add, create or draft a scenario or agent here.
---

# Write a new scenario

You're adding a scenario to `public/scenarios/`. Read `public/scenarios/bikeShop/` before writing: it's the pattern to follow. `knowledgeAgent/` shows a help center search, and `textAgent/` shows a voice agent backed by an existing chat agent. Don't copy `simpleHandoff.js`: it's an OpenAI-compatibility example, and its multi-agent handoffs aren't how to build on Dialog-RSN-1.

## 1. Ask, briefly

If the request doesn't already say, ask in one message:

- The business, and what callers ring about. Two or three tasks is plenty.
- What the agent must never do, and anything it must say, such as a recording disclosure.
- The tone, in a few words.

Then write it all without further questions. Everything is made up: invent a company name, people, numbers and data, and never use a real company. Only build a bring-your-text-agent scenario if they say they already have a chat agent to reuse.

## 2. Write the files

One folder, `public/scenarios/<key>/`: `index.js` exporting `[theAgent]`, and `data.js` for test data and topics. Use `agent()`, `tool()`, `spoken()`, `withKnowledge()`, `goToStep()`, `sayExactly()` and `endCall()` from `../../lib/agents.js`, and `transferCallTool()` and `endCallTool()` from `../../lib/callTools.js`.

One agent runs the whole call:

- **`welcomeMessage`**: the first line, word for word, with any compliance line in it. The page sends it as `poly_first_assistant_message`. The prompt never says how to greet.
- **`callerNumber`**: a test caller ID, so the prompt can use it.
- **`instructions`**: a function of the call, `(call) => ...`, with `call.today`, `call.weekday` and `call.callerNumber`. Write who the agent is and its tone in two sentences, then "Your goal is ...", then a short list of hard rules, then today's date and the caller ID. Keep it under about 300 words.
- **`knowledge`**: topics on the session from the first turn, `{ name, content, actions? }`. Use `actions` to say what to do about a topic, often which function to call. A process simple enough to describe in a few sentences is a topic with actions, not a step.
- **`tools`**: the functions available all call, always including `transferCallTool({ reasons: [...] })` and `endCallTool("goodbye line")`.
- **`steps`**: only where a process needs more guidance than the prompt. Each is `{ prompt, tools }`. A tool enters it with `goToStep("name", output)`, and a `finish_<step>` tool leaves it with `goToStep(null)`.

What not to write in a prompt:

- A turn-by-turn script, a JSON list of conversation states, or "Say: '...'" lines. Dialog-RSN-1 runs the conversation itself.
- How to collect a value: "repeat it back digit by digit", "wait for them to confirm", "ask for the year". The model gathers and corrects details on its own. If you want a specific behaviour, say it once in plain language.
- "Always call X, even with partial input". Forcing a call makes the model call it with half the value.
- "Everything you say is spoken, no lists or markdown", or "never answer from your own knowledge". The model already does both.

Functions:

- Make them high level: one function per thing the business does, whose parameters say what to collect (`verify_customer(phone_number, date_of_birth)`), called once the agent has everything.
- The function enforces the rule, not the prompt: return `{ error: "not_verified" }` and so on. Keep shared per-call state in `ctx.state`.
- Decisions are code. A policy check returns the decision and, with `withKnowledge`, the policy topics it rests on. Never ask a second model to decide.
- Give a `spoken()` argument named `utterance` only to tools that are slow or change something (create, send, book, submit). Not to lookups or step changes.
- Validate against the test data and return a clear `{ error }` or `{ found: 0 }` when nothing matches.
- A tool that should answer with a fixed line returns `sayExactly(line, output)`. `transfer_call` and `end_call` end the call.

## 3. Register and check

1. Add the scenario to `allAgentSets` and `labels` in `public/scenarios/index.js`.
2. Add a scripted caller to `JOURNEYS` in `scripts/check.js`: five to eight short lines that walk the main task end to end with the test data, and end with a goodbye.
3. Run `npm run check -- <key>` (needs `POLY_API_KEY`). Read the whole transcript as well as the summary. Fix the prompt, a topic's actions or a function's description where the agent stalls, quotes a figure no tool returned, skips a function, or offers something it can't do. Fix the function where it lets a rule be broken. Then run it again.
4. Tell the user what you built, the test data to use when they try it in the page, and anything the check showed that you couldn't fix.
