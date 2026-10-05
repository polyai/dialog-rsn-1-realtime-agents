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
import { allAgentSets } from "../public/scenarios/index.js";

const URL = process.env.POLY_URL || "wss://api.us.poly.ai/v1/realtime";
const KEY = process.env.POLY_API_KEY;
if (!KEY) {
  console.error("POLY_API_KEY is not set.");
  process.exit(1);
}

// In Node there's no relay: connect straight to the API with the key.
const connect = () => new WebSocket(URL, { headers: { "X-API-KEY": KEY, "User-Agent": "dialog-rsn-1-realtime-agents-check/1.0" } });

const JOURNEYS = {
  simpleHandoff: ["Hi there!", "Yes please, one about the sea."],
  customerServiceRetail: [
    "Hi, I'd like to return a helmet I bought.",
    "It's 555 201 4477.",
    "Yes, that's right.",
    "March 14th, 1988.",
    "Yes.",
    "It's the Aero commuter helmet from my September order. It's still unopened, I just don't need it.",
    "Yes, please go ahead with the return.",
  ],
  chatSupervisor: ["Hi", "I'm wondering why my last bill was so high.", "It's 206 135 1246.", "Yes, that's right.", "Is there something cheaper for calling Portugal?"],
  knowledgeAgent: ["Hi, how do I send you a meter reading?", "And what happens if I miss it?", "Who won the World Cup in 2018?"],
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
  const agents = allAgentSets[key];
  const session = new RealtimeSession({ label: "voice", connect });
  const stats = { failed: 0, handoffs: [], tools: [], cited: [], outOfDomain: 0, errors: [] };
  const runner = new AgentRunner({
    agents,
    session,
    extras: {
      connect,
      onSession: (s) => s.on("error", (e) => stats.errors.push(`[${s.label}] ${e.error?.message}`)),
    },
  });
  runner.on("handoff", ({ from, to }) => {
    stats.handoffs.push(`${from}->${to}`);
    console.log(gray(`   handoff ${from} -> ${to}`));
  });
  runner.on("breadcrumb", ({ title }) => console.log(gray(`   ${title}`)));
  session.on("tool.call", ({ call }) => {
    stats.tools.push(call.name);
    console.log(gray(`   tool ${call.name} ${JSON.stringify(call.args)}`));
  });
  session.on("agent.done", ({ text }) => text && console.log(`   ${runner.current.name}: ${text}`));
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
  await session.connect({ type: "realtime", output_modalities: ["text"], ...runner.sessionConfig() });
  // The agent speaks first, as it would answering the phone.
  session.requestResponse();
  await settled(session);
  for (const line of JOURNEYS[key]) {
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
