/**
 * Agents, tools and flow steps.
 *
 * An agent is what a call runs on from start to finish: one system prompt, a welcome message,
 * a voice, always-on knowledge, and tools. The prompt never changes during the call. Where a
 * process needs one, a tool moves the call into a flow step: the step's prompt goes into the
 * history at that point, as a system message, and the tools change to the step's.
 *
 * A tool's `execute(args, ctx)` returns plain data for the model, or one of these:
 *   withKnowledge(output, topics)   topics ride on the output as `poly_knowledge`
 *   goToStep(name, output)          enter a flow step (null leaves the flow)
 *   sayExactly(utterance, output)   the page says this line word for word; the model doesn't
 *                                   write a reply to this tool
 *   endCall(utterance, output)      say the line, then hang up
 *   hangUp(output)                  hang up once this turn's spoken line has played
 *   setSession(fields, output)      change session fields first, e.g. poly_response_language
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
 * End the call after the model's own last line: the tool's `poly_spoken` argument, said as
 * it calls the tool. Nothing is said after it.
 */
export const hangUp = (output = { ok: true }) => new ToolResult({ output, hangup: true });

/** Update the session (e.g. `poly_response_language`) before the output goes back. */
export const setSession = (fields, output = { ok: true }) => new ToolResult({ output, session: fields });

/**
 * @param {object} a
 * @param {string} a.name
 * @param {string} [a.description] one line, shown in the page
 * @param {string | ((call: CallContext) => string)} a.instructions the system prompt. A
 *        function gets this call's context (caller's number, today's date).
 * @param {string} [a.welcomeMessage] the first thing the agent says, word for word
 * @param {string} [a.voice] the Cartesia voice id the page speaks this agent in, unless the
 *        visitor picks another
 * @param {Array<{name: string, content: string, actions?: string}>} [a.knowledge] topics on
 *        the session from the first turn, like always-retrieved topics
 * @param {Array} [a.tools] tools available everywhere in the call
 * @param {Record<string, {prompt: string, tools?: Array}>} [a.steps] flow steps
 * @param {string} [a.callerNumber] the test caller's number, as caller ID would give it
 *
 * @typedef {{ callerNumber: string | null, today: string, weekday: string }} CallContext
 */
export function agent({ name, description = "", instructions, welcomeMessage, voice, knowledge, tools = [], steps = {}, callerNumber }) {
  return { name, description, instructions, welcomeMessage, voice, knowledge, tools, steps, callerNumber };
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

const schema = ({ name, description, parameters }) => ({ type: "function", name, description, parameters });

export function callContext(a, date = new Date()) {
  return {
    callerNumber: a.callerNumber ?? null,
    // The caller's local date, so it agrees with the weekday below (UTC can be a day ahead).
    today: date.toLocaleDateString("en-CA"),
    weekday: date.toLocaleDateString("en-US", { weekday: "long" }),
  };
}

/** The tools live in this step: the agent's own and the step's. */
function activeTools(a, stepName) {
  return [...a.tools, ...(a.steps[stepName]?.tools ?? [])];
}

/** The `session.update` fields that make the session this agent, in this step. */
export function sessionFor(a, { stepName = null, call = callContext(a) } = {}) {
  return {
    instructions: typeof a.instructions === "function" ? a.instructions(call) : a.instructions,
    tools: activeTools(a, stepName).map(schema),
    poly_knowledge: a.knowledge ?? [],
  };
}

/**
 * Runs an agent on a session: answers tool calls, moves between flow steps, says fixed
 * lines, and ends the call.
 *
 * Events: step {from, to}, say {utterance, hangup}, hangup {responseId}, session {fields},
 * breadcrumb {title, data}
 */
export class AgentRunner {
  constructor({ agent, session }) {
    this.agent = agent;
    this.call = callContext(agent);
    this.step = null;
    this.stepItemId = null;
    this.state = {}; // per-call state the tools share, e.g. the verified customer
    this.session = session;
    this.handlers = new Map();
    this.stepCount = 0;
    session.onToolCall = (call) => this.onToolCall(call);
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
    const session = sessionFor(this.agent, { call: this.call });
    if (this.agent.welcomeMessage) session.poly_first_assistant_message = this.agent.welcomeMessage;
    return session;
  }

  /** A typed caller turn. */
  say(text) {
    this.session.sendText(text);
  }

  async onToolCall(call) {
    const t = activeTools(this.agent, this.step).find((x) => x.name === call.name);
    if (!t) return { output: { error: `unknown tool '${call.name}'` } };
    if (call.args === null) return { output: { error: "arguments were not valid JSON" } };
    const ctx = {
      agent: this.agent,
      step: this.step,
      call: this.call,
      state: this.state,
      breadcrumb: (title, data) => this.emit("breadcrumb", { title, data }),
    };
    const result = await t.execute(call.args ?? {}, ctx);
    if (!(result instanceof ToolResult)) return { output: result ?? "" };

    const out = { output: result.output, knowledge: result.knowledge };
    if (result.session) {
      // Before the output goes back, so the follow-up response already has the change.
      this.session.update(result.session);
      this.emit("session", { fields: result.session });
    }
    if (result.step !== undefined) Object.assign(out, this.enterStep(result.step));
    if (result.say) {
      out.say = result.say;
      out.hangup = result.hangup ?? false;
      this.emit("say", { utterance: result.say, hangup: out.hangup });
    } else if (result.hangup) {
      out.hangup = true;
      this.emit("hangup", { responseId: call.responseId });
    }
    return out;
  }

  /**
   * Change step. The tools change now; the session sends the rest after the tool's output:
   * the last step's prompt removed (`remove`), and this step's added (`system`).
   */
  enterStep(name) {
    if (name !== null && !this.agent.steps[name]) throw new Error(`no step '${name}' on ${this.agent.name}`);
    const from = this.step;
    const remove = this.stepItemId ?? undefined;
    this.step = name;
    // The page picks the step prompt's item id, so the next step can remove it: only the
    // current step's prompt stays in the history.
    this.stepItemId = name === null ? null : `step_${++this.stepCount}`;
    this.session.update({ tools: sessionFor(this.agent, { stepName: name, call: this.call }).tools });
    this.emit("step", { from, to: name, prompt: name && this.agent.steps[name].prompt });
    return { remove, system: name === null ? undefined : stepMessage(this.agent.steps[name].prompt), systemId: this.stepItemId ?? undefined };
  }
}
