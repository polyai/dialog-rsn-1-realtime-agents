/**
 * Agents, tools and flow steps.
 *
 * An agent is what a call runs on from start to finish: one system prompt, a welcome message,
 * always-on knowledge, and tools. The prompt never changes during the call. Where a process
 * needs one, a tool moves the call into a flow step: the step's prompt goes into the
 * history at that point, as a system message, and the tools change to the step's.
 *
 * A tool's `execute(args, ctx)` returns plain data for the model, or one of these:
 *   withKnowledge(output, topics)   topics ride on the output as `poly_knowledge`
 *   goToStep(name, output)          enter a flow step (null leaves the flow)
 *   sayExactly(utterance, output)   the page says this line word for word; the model doesn't
 *                                   write a reply to this tool
 *   endCall(utterance, output)      say the line, then hang up
 *
 * Handoffs between agents (`handoffs: [...]`) are here for one example only, the one for
 * developers moving from openai-realtime-agents. See the README for what each costs.
 */

/** A function tool. `execute(args, ctx)` returns the output, or one of the helpers above. */
export function tool({ name, description, parameters = { type: "object", properties: {} }, execute }) {
  return { name, description, parameters, execute };
}

class ToolResult {
  constructor(fields) {
    Object.assign(this, fields);
  }
}

/**
 * Attach knowledge to a tool's output. The topics ride on the `function_call_output` as
 * `poly_knowledge`, the model can answer from them, and `response.done` names the ones it
 * used in `poly_cited_topics`.
 */
export const withKnowledge = (output, topics) => new ToolResult({ output, knowledge: topics });

/** Move the call into a flow step of the current agent, or out of the flow with `null`. */
export const goToStep = (step, output = { ok: true }) => new ToolResult({ output, step });

/**
 * A fixed line, said word for word with no generation. It's added to the history as the
 * agent's turn, and the call waits for the caller.
 */
export const sayExactly = (utterance, output = { ok: true }) => new ToolResult({ output, say: utterance });

/** Say a fixed line, then end the call: a transfer to a person, or a goodbye. */
export const endCall = (utterance, output = { ok: true }) => new ToolResult({ output, say: utterance, hangup: true });

/**
 * @param {object} a
 * @param {string} a.name
 * @param {string} [a.description] one line, shown in the page
 * @param {string | ((call: CallContext) => string)} a.instructions the system prompt. A
 *        function gets this call's context (caller's number, today's date).
 * @param {string} [a.welcomeMessage] the first thing the agent says, word for word
 * @param {Array<{name: string, content: string, actions?: string}>} [a.knowledge] topics on
 *        the session from the first turn, like always-retrieved topics
 * @param {Array} [a.tools] tools available everywhere in the call
 * @param {Record<string, {prompt: string, tools?: Array}>} [a.steps] flow steps
 * @param {Array} [a.handoffs] other agents (the OpenAI-compatibility example only)
 * @param {string} [a.callerNumber] the test caller's number, as caller ID would give it
 *
 * @typedef {{ callerNumber: string | null, today: string, weekday: string }} CallContext
 */
export function agent({ name, description = "", instructions, welcomeMessage, knowledge, tools = [], steps = {}, handoffs = [], callerNumber }) {
  return { name, description, instructions, welcomeMessage, knowledge, tools, steps, handoffs, callerNumber };
}

/**
 * A tool argument marked `poly_spoken` is said to the caller while the tool runs: the model
 * writes it, it streams as reply text beside the call, and the page speaks it. Use it on
 * tools that are slow or change something. A fast lookup or a step change doesn't need one.
 */
export const spoken = (description) => ({ type: "string", description, poly_spoken: true });

// The wording the platform wraps a step prompt in, so the model sees the same shape it was
// trained on.
const stepMessage = (prompt) => `Given the previous context, here are some additional guidelines to help you with your task:
${prompt.trim()}

Make sure to address any question the user asks before proceeding.
Always collect all required pieces of information from the user before proceeding.

Remember to be conversational and brief.`;

const transferName = (target) => `transfer_to_${target.name}`;

function transferTool(target) {
  return {
    type: "function",
    name: transferName(target),
    description: `Hand the caller to ${target.name}. ${target.description}`.trim(),
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

/** What a tool's `execute` returned, as a session wants it: { output, knowledge? }. */
export function asToolResult(result) {
  return result instanceof ToolResult ? { output: result.output, knowledge: result.knowledge } : { output: result ?? "" };
}

const schema = ({ name, description, parameters }) => ({ type: "function", name, description, parameters });

export function callContext(a, date = new Date()) {
  return {
    callerNumber: a.callerNumber ?? null,
    today: date.toISOString().slice(0, 10),
    weekday: date.toLocaleDateString("en-US", { weekday: "long" }),
  };
}

/** The tools live in this agent and step: the agent's own, the step's, and any handoffs. */
function activeTools(a, stepName) {
  return [...a.tools, ...(a.steps[stepName]?.tools ?? [])];
}

/** The `session.update` fields that make the session this agent, in this step. */
export function sessionFor(a, { stepName = null, call = callContext(a) } = {}) {
  return {
    instructions: typeof a.instructions === "function" ? a.instructions(call) : a.instructions,
    tools: [...activeTools(a, stepName).map(schema), ...a.handoffs.map(transferTool)],
    // Knowledge on the session from the first turn. Unset on a handoff so it doesn't linger.
    poly_knowledge: a.knowledge ?? [],
  };
}

/**
 * Runs a scenario on a session: answers tool calls, moves between flow steps, says fixed
 * lines, ends the call, and keeps a plain transcript for tools that need the conversation so
 * far (the text agent bridge).
 *
 * Events: step {from, to}, handoff {from, to, reason}, say {utterance, hangup}, breadcrumb {title, data}
 */
export class AgentRunner {
  constructor({ agents, start, session, extras = {} }) {
    this.agents = agents;
    this.current = agents.find((a) => a.name === start) ?? agents[0];
    this.call = callContext(this.current);
    this.step = null;
    this.stepItemId = null;
    this.state = {}; // per-call state the tools share, e.g. the verified customer
    this.session = session;
    this.extras = extras; // handed to every tool in ctx, e.g. the text agent's connect function
    this.history = [];
    this.handlers = new Map();
    session.onToolCall = (call) => this.onToolCall(call);
    session.on("agent.done", ({ text }) => text && this.history.push({ role: "assistant", agent: this.current.name, text }));
    session.on("conversation.item.input_audio_transcription.completed", (e) => e.transcript && this.history.push({ role: "user", text: e.transcript }));
    // The step prompt's item id, so the next step can remove it: only the current step's
    // prompt stays in the history.
    session.on("conversation.item.added", ({ item }) => {
      if (item?.role === "system" && this.pendingStepText && textOf(item) === this.pendingStepText) {
        this.stepItemId = item.id;
        this.pendingStepText = null;
      }
    });
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
  }

  emit(type, payload) {
    for (const fn of this.handlers.get(type) ?? []) fn(payload);
  }

  /**
   * The session fields for the first `session.update`, welcome message included. The server
   * says it as the first response once the session is ready, so nothing sends
   * `response.create` to open the call.
   */
  sessionConfig() {
    const session = sessionFor(this.current, { call: this.call });
    if (this.current.welcomeMessage) session.poly_first_assistant_message = this.current.welcomeMessage;
    return session;
  }

  /** A typed caller turn. */
  say(text) {
    this.history.push({ role: "user", text });
    this.session.sendText(text);
  }

  async onToolCall(call) {
    const target = this.current.handoffs.find((a) => transferName(a) === call.name);
    if (target) return this.handoff(target, call.args?.reason);

    const t = activeTools(this.current, this.step).find((x) => x.name === call.name);
    if (!t) return { output: { error: `unknown tool '${call.name}'` } };
    if (call.args === null) return { output: { error: "arguments were not valid JSON" } };
    const ctx = {
      agent: this.current,
      step: this.step,
      call: this.call,
      state: this.state,
      history: [...this.history],
      breadcrumb: (title, data) => this.emit("breadcrumb", { title, data }),
      ...this.extras,
    };
    const result = await t.execute(call.args ?? {}, ctx);
    if (!(result instanceof ToolResult)) return { output: result ?? "" };

    const out = { output: result.output, knowledge: result.knowledge };
    if (result.step !== undefined) Object.assign(out, this.enterStep(result.step));
    if (result.say) {
      out.say = result.say;
      out.hangup = result.hangup ?? false;
      this.history.push({ role: "assistant", agent: this.current.name, text: result.say });
      this.emit("say", { utterance: result.say, hangup: out.hangup });
    }
    return out;
  }

  /**
   * Change step. The tools change now; the session sends the rest after the tool's output:
   * the last step's prompt removed (`remove`), and this step's added (`system`).
   */
  enterStep(name) {
    if (name !== null && !this.current.steps[name]) throw new Error(`no step '${name}' on ${this.current.name}`);
    const from = this.step;
    const remove = this.stepItemId ?? undefined;
    this.step = name;
    this.stepItemId = null;
    this.session.update({ tools: sessionFor(this.current, { stepName: name, call: this.call }).tools });
    this.emit("step", { from, to: name, prompt: name && this.current.steps[name].prompt });
    this.pendingStepText = name === null ? null : stepMessage(this.current.steps[name].prompt);
    return { remove, system: this.pendingStepText ?? undefined };
  }

  handoff(target, reason) {
    const from = this.current;
    this.current = target;
    this.step = null;
    // Swap the agent before the call's output goes back, so the follow-up response, which
    // the session sends next, is the new agent's first turn.
    this.session.update(sessionFor(target, { call: this.call }));
    this.emit("handoff", { from: from.name, to: target.name, reason });
    return { output: { transferred_to: target.name } };
  }

  /** Switch agent by hand (the agent picker, in the handoff example). */
  switchTo(name) {
    const target = this.agents.find((a) => a.name === name);
    if (!target || target === this.current) return;
    const from = this.current;
    this.current = target;
    this.step = null;
    this.session.update(sessionFor(target, { call: this.call }));
    this.emit("handoff", { from: from.name, to: target.name, reason: "switched in the agent picker" });
  }
}

const textOf = (item) => (item.content ?? []).map((c) => c.text ?? "").join("");
