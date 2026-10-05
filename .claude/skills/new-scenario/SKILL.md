---
name: new-scenario
description: Write a new Dialog-RSN-1 voice agent scenario for this repo (agents, prompts, tools, test data and a check journey) from a description of the business. Use when asked to add, create or draft a scenario or agent here.
---

# Write a new scenario

You're adding a scenario to `public/scenarios/`. Read `public/scenarios/simpleHandoff.js` and one fuller example before writing: `customerServiceRetail/` for handoffs, `chatSupervisor/` for a supervisor, `knowledgeAgent/` for a knowledge base.

## 1. Ask, briefly

If the request doesn't already say, ask in one message:

- The business, and what callers ring about. Two or three tasks is plenty.
- The pattern: one agent, agents that hand off to each other, a voice agent with a supervisor, or a knowledge agent. Suggest one if they're unsure.
- The tone, in a few words.

Then write it all without further questions. Everything is made up: invent a company name, people, numbers and data, and never use a real company.

## 2. Write the files

Put a single-agent scenario in one file, `public/scenarios/<key>.js`. Anything larger gets a folder, `public/scenarios/<key>/`, with `index.js` exporting the agents array, one file per agent, and a `data.js` for test data.

For each agent, use `agent()`, `tool()`, `spoken()` and `withKnowledge()` from `../lib/agents.js` (adjust the path for folders).

Prompts:
- Start with personality and tone, then the task, then rules. For multi-step tasks such as verification, add a JSON list of conversation states, as `customerServiceRetail/authentication.js` does.
- Everything the model writes is spoken: say short sentences, no lists, markdown, symbols or URLs.
- Facts, prices, dates and account details come only from tools. Say so.
- Name every agent it can transfer to, and say it can't promise anything else.
- Keep each agent's instructions and tool schemas under about 2,000 words. The context is 32k tokens and the call needs room.

Tools:
- Give any tool that takes noticeable time, or hands the caller over, a `spoken()` argument named `utterance` (or `filler`), so the caller hears something while it runs. Transfer tools get one automatically.
- `execute(args, ctx)` returns plain data, or `withKnowledge(output, topics)` to attach `poly_knowledge`. `ctx.history` is the conversation so far; `ctx.connect` and `ctx.onSession` are what `runTextAgent` needs for a supervisor or reviewer session.
- Validate lookups against the test data and return a clear `{ error }` or `{ found: 0 }` when nothing matches.

Handoffs: wire them in the scenario's `index.js` with `agent.handoffs.push(...)`, as `customerServiceRetail/index.js` does. The first agent in the exported array is where calls start.

## 3. Register and check

1. Add the scenario to `allAgentSets` and `labels` in `public/scenarios/index.js`.
2. Add a scripted caller to `JOURNEYS` in `scripts/check.js`: five to eight short lines that walk the main task end to end, using the test data.
3. Run `npm run check -- <key>` (needs `POLY_API_KEY`). Read the transcript, not just the summary. Fix prompts where the agent stalls, announces a transfer without calling the tool, or quotes a figure no tool returned, then run it again.
4. Tell the user what you built, the test data to use when they try it in the page, and anything the check showed that you couldn't fix.
