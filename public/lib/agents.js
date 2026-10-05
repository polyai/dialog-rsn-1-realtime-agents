/**
 * Agents, tools and handoffs.
 *
 * An agent is instructions plus tools, and the agents it may hand the caller to. A scenario
 * is an array of agents; the first is where a call starts. A handoff is a tool call: each
 * agent gets a `transfer_to_<name>` tool per handoff, and when the model calls one, the
 * runner swaps the session's instructions and tools for the new agent's with one
 * `session.update`. Same conversation, same history, new agent.
 */

/** A function tool. `execute(args, ctx)` returns the output, or `withKnowledge(...)`. */
export function tool({ name, description, parameters = { type: "object", properties: {} }, execute }) {
  return { name, description, parameters, execute };
}

/**
 * Attach knowledge to a tool's output. The topics ride on the `function_call_output` as
 * `poly_knowledge`, the model can answer from them, and `response.done` names the ones it
 * used in `poly_cited_topics`.
 */
export function withKnowledge(output, topics) {
  return new ToolResult(output, topics);
}

class ToolResult {
  constructor(output, knowledge) {
    this.output = output;
    this.knowledge = knowledge;
  }
}

/** What a tool's `execute` returned, as the session wants it: { output, knowledge? }. */
export function asToolResult(result) {
  return result instanceof ToolResult ? { output: result.output, knowledge: result.knowledge } : { output: result ?? "" };
}

export function agent({ name, handoffDescription = "", instructions, tools = [], handoffs = [], knowledge }) {
  return { name, handoffDescription, instructions, tools, handoffs, knowledge };
}

/**
 * A tool argument marked `poly_spoken` is said to the caller while the tool runs: the model
 * writes it, it streams as reply text beside the call, and the page speaks it. So a turn
 * that needs a tool, or a handoff, is never silent.
 */
export const spoken = (description) => ({ type: "string", description, poly_spoken: true });

const transferName = (target) => `transfer_to_${target.name}`;

function transferTool(target) {
  return {
    type: "function",
    name: transferName(target),
    description: `Hand the caller to ${target.name}. ${target.handoffDescription}`.trim(),
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Why the caller needs this agent, in a few words." },
        utterance: spoken("A short line telling the caller you're passing them on, e.g. 'Let me get you to our returns team.'"),
      },
      required: ["reason", "utterance"],
    },
  };
}

/** The `session.update` fields that make the session this agent. */
export function sessionFor(a) {
  const session = {
    instructions: a.instructions,
    tools: [
      ...a.tools.map(({ name, description, parameters }) => ({ type: "function", name, description, parameters })),
      ...a.handoffs.map(transferTool),
    ],
  };
  // A fixed brief, present from the first turn. Unset it on a handoff so it doesn't linger.
  session.poly_knowledge = a.knowledge ?? [];
  return session;
}

/**
 * Runs a scenario on a session: answers tool calls, performs handoffs, and keeps a plain
 * transcript for tools that need the conversation so far (the supervisor, the returns check).
 *
 * Events: handoff {from, to, reason}, breadcrumb {title, data}
 */
export class AgentRunner {
  constructor({ agents, start, session, extras = {} }) {
    this.agents = agents;
    this.current = agents.find((a) => a.name === start) ?? agents[0];
    this.session = session;
    this.extras = extras; // handed to every tool in ctx, e.g. the supervisor's connect function
    this.history = [];
    this.handlers = new Map();
    session.onToolCall = (call) => this.onToolCall(call);
    session.on("agent.done", ({ text }) => text && this.history.push({ role: "assistant", agent: this.current.name, text }));
    session.on("conversation.item.input_audio_transcription.completed", (e) => e.transcript && this.history.push({ role: "user", text: e.transcript }));
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
  }

  emit(type, payload) {
    for (const fn of this.handlers.get(type) ?? []) fn(payload);
  }

  /** The current agent's session fields, for the first `session.update`. */
  sessionConfig() {
    return sessionFor(this.current);
  }

  /** A typed caller turn. */
  say(text) {
    this.history.push({ role: "user", text });
    this.session.sendText(text);
  }

  async onToolCall(call) {
    const target = this.current.handoffs.find((a) => transferName(a) === call.name);
    if (target) return this.handoff(target, call.args?.reason);

    const t = this.current.tools.find((x) => x.name === call.name);
    if (!t) return { output: { error: `unknown tool '${call.name}'` } };
    if (call.args === null) return { output: { error: "arguments were not valid JSON" } };
    const ctx = {
      agent: this.current,
      history: [...this.history],
      breadcrumb: (title, data) => this.emit("breadcrumb", { title, data }),
      ...this.extras,
    };
    return asToolResult(await t.execute(call.args ?? {}, ctx));
  }

  handoff(target, reason) {
    const from = this.current;
    this.current = target;
    // Swap the agent before the call's output goes back, so the follow-up response, which
    // the session sends next, is the new agent's first turn.
    this.session.update(sessionFor(target));
    this.emit("handoff", { from: from.name, to: target.name, reason });
    return { output: { transferred_to: target.name } };
  }

  /** Switch agent by hand (the agent picker). */
  switchTo(name) {
    const target = this.agents.find((a) => a.name === name);
    if (!target || target === this.current) return;
    const from = this.current;
    this.current = target;
    this.session.update(sessionFor(target));
    this.emit("handoff", { from: from.name, to: target.name, reason: "switched in the agent picker" });
  }
}
