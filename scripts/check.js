/**
 * Runs each scenario's text journey against Dialog-RSN-1 from the terminal, with the same
 * agents, tools and session code the page uses. A quick way to check your key and your
 * scenarios before opening the browser.
 *
 *   npm run check                       # every scenario
 *   npm run check -- knowledgeAgent     # one
 */
import WebSocket from "ws";
import { RealtimeSession } from "../public/lib/session.js";
import { AgentRunner } from "../public/lib/agents.js";
import { scenarios } from "../public/scenarios/index.js";

const URL = process.env.DIALOG_REALTIME_URL || "wss://api.studio.poly.ai/v1/realtime";
const KEY = process.env.POLY_API_KEY;
if (!KEY) {
  console.error("POLY_API_KEY is not set.");
  process.exit(1);
}

// In Node there's no relay: connect straight to the API with the key.
const connect = () => new WebSocket(URL, { headers: { "X-API-KEY": KEY, "User-Agent": "dialog-rsn-1-realtime-agents-check/1.0" } });

// A scripted caller per scenario. A journey stops early if the agent ends the call.
const JOURNEYS = {
  restaurant: [
    "Hi, I'd like to book a table for Friday at half seven, for four people.",
    "It's for Sam Okafor. Oh, and it's her birthday, and one of us is gluten free.",
    "Yes, that's right.",
    "What's on the Omakase menu?",
    "Great, that's all. Bye!",
  ],
  knowledgeAgent: [
    "Hi, how do I send you a meter reading?",
    "Can I give you one now? It's the electricity meter, and it says 4 8 2 1 7.",
    "And what happens if I miss the date?",
    "Who won the World Cup in 2018?",
    "No, that's everything, thanks. Bye!",
  ],
  bikeShop: [
    "Hi, I'd like to return a helmet I bought.",
    "Yes, this is the number on my account.",
    "March 14th, 1988.",
    "The Aero commuter helmet. It's still unopened, I just don't need it.",
    "A refund, please. Go ahead.",
    "No, that's all. Thanks, bye.",
  ],
};

const gray = (s) => `\x1b[90m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

/** Resolves once the session has been quiet (listening, nothing pending) for `ms`. */
function settled(session, ms = 600, timeout = 45_000) {
  return new Promise((resolve, reject) => {
    let timer;
    const check = () => {
      clearTimeout(timer);
      if (session.state === "listening") timer = setTimeout(done, ms);
    };
    const done = () => {
      off();
      clearTimeout(limit);
      resolve();
    };
    const off = session.on("state", check);
    const limit = setTimeout(() => {
      off();
      reject(new Error(`no answer within ${timeout / 1000} s`));
    }, timeout);
    check();
  });
}

async function run(key) {
  console.log(bold(`\n== ${key}`));
  const session = new RealtimeSession({ label: "voice", connect });
  const stats = { failed: 0, steps: [], tools: [], cited: [], outOfDomain: 0, ended: false, errors: [] };
  const runner = new AgentRunner({ agent: scenarios[key], session });
  runner.on("step", ({ from, to }) => {
    stats.steps.push(to ?? `-${from}`);
    console.log(gray(to ? `   step ${to}` : `   left step ${from}`));
  });
  runner.on("say", ({ utterance, hangup }) => {
    console.log(`   ${runner.agent.name}: ${utterance} ${gray("(fixed line)")}`);
    if (hangup) {
      stats.ended = true;
      console.log(gray("   call ended"));
    }
  });
  runner.on("hangup", () => {
    stats.ended = true;
    console.log(gray("   call ended"));
  });
  runner.on("breadcrumb", ({ title }) => console.log(gray(`   ${title}`)));
  session.on("tool.call", ({ call }) => {
    stats.tools.push(call.name);
    console.log(gray(`   tool ${call.name} ${JSON.stringify(call.args)}`));
  });
  session.on("agent.done", ({ text }) => text && console.log(`   ${runner.agent.name}: ${text}`));
  session.on("response.done", ({ response }) => {
    if (response.status === "failed") stats.failed++;
    if (response.poly_cited_topics) {
      stats.cited.push(...response.poly_cited_topics);
      console.log(gray(`   cited ${response.poly_cited_topics.join(", ")}`));
    }
    if (response.poly_out_of_domain) {
      stats.outOfDomain++;
      console.log(gray("   out of domain"));
    }
  });
  session.on("error", (e) => stats.errors.push(e.error?.message));

  const started = Date.now();
  // The welcome message is said by the server as the first response, with no response.create.
  const welcome = new Promise((resolve) => {
    const off = session.on("agent.done", () => (off(), resolve()));
    setTimeout(resolve, 10_000);
  });
  await session.connect({ type: "realtime", output_modalities: ["text"], ...runner.sessionConfig() });
  await welcome;
  await settled(session);
  for (const line of JOURNEYS[key]) {
    if (stats.ended) break;
    console.log(`   caller: ${line}`);
    runner.say(line);
    await settled(session);
  }
  session.close();
  return { ...stats, seconds: Math.round((Date.now() - started) / 100) / 10 };
}

const only = process.argv.slice(2);
const results = {};
for (const key of Object.keys(JOURNEYS)) {
  if (only.length && !only.includes(key)) continue;
  try {
    results[key] = await run(key);
  } catch (err) {
    results[key] = { error: err.message };
  }
}
console.log(bold("\n== Summary"));
for (const [key, r] of Object.entries(results)) console.log(`${key}: ${JSON.stringify(r)}`);
process.exit(Object.values(results).some((r) => r.error || r.failed || r.errors?.length) ? 1 : 0);
