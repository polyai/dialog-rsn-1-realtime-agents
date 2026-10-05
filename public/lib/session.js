/**
 * One Dialog-RSN-1 realtime session, on the raw wire protocol.
 *
 * Everything the app sends goes through here, because a few ordering rules keep a session
 * healthy, and breaking one fails every later response with `generation_failed`:
 *
 *  1. The tool gate. From the moment a function call appears (`response.output_item.added`)
 *     until its output and the follow-up `response.create` are sent, nothing else enters
 *     the conversation. Typed text waits.
 *  2. Answer every call of a completed response, and never one from a response that was
 *     cancelled or failed. Decide by `response.done`'s status and nothing else.
 *  3. Pass `call_id` back exactly as it came (37 characters).
 *  4. One `response.create` at a time. Typed text also waits while the caller is speaking,
 *     or the server is about to answer what they said, so it isn't folded into their turn.
 *
 * It also strips the emotion tag a reply may open with (`[cheerful] Hello`), sends playback
 * reports for client-side speech, and keeps an idle connection open.
 *
 * Events: every server event by its own `type`, `*` for all of them, plus:
 *   sent {event}                     every client event, for the event log
 *   agent.delta {responseId, itemId, delta, text}   clean reply text as it streams
 *   agent.done {responseId, itemId, text, emotion}
 *   tool.call {call}  tool.result {call, output, error, ms}
 *   state {state}                    connecting, listening, user_speaking, thinking, responding
 */

const KEEPALIVE_AFTER_MS = 240_000; // the server closes a connection idle for 300 s
const AUTO_RESPONSE_WAIT_MS = 1_000; // after speech_stopped, how long to expect the server's own response
const CREATE_WAIT_MS = 5_000; // a response.create that got no response.created by then is given up on
const MAX_TAG_HOLD = 24;
const CONNECT_TIMEOUT_MS = 12_000;

export class RealtimeSession {
  /**
   * @param {object} opts
   * @param {string} [opts.label] name shown in the event log, e.g. "voice" or "supervisor"
   * @param {() => WebSocket} opts.connect opens the socket (through the relay in a browser)
   * @param {(call: object) => Promise<object>} [opts.onToolCall] answers a function call:
   *        resolves to { output, knowledge? }. Throwing sends {"error": ...} as the output.
   */
  constructor({ label = "voice", connect, onToolCall }) {
    this.label = label;
    this.openSocket = connect;
    this.onToolCall = onToolCall;
    this.handlers = new Map();
    this.queue = []; // typed turns and push-to-talk commits waiting for their moment
    this.calls = new Map(); // response id -> [{ itemId, call_id, name, arguments }]
    this.replies = new Map(); // response id -> { raw, clean, tag, tagDone, itemId }
    this.reports = new Map(); // response id -> { started, stopped, sent }
    this.createResponse = true;
    this.flags = { open: false, ready: false, userSpeaking: false, awaitingAuto: false, openResponse: null, pendingCreate: 0, toolGate: 0 };
    this.state = "closed";
  }

  // ---- Events --------------------------------------------------------------------------

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type).delete(fn);
  }

  emit(type, payload) {
    for (const fn of this.handlers.get(type) ?? []) fn(payload);
  }

  // ---- Connecting --------------------------------------------------------------------

  /** Open the socket and apply the first session config. Resolves on `session.updated`. */
  connect(session) {
    this.createResponse = session.audio?.input?.turn_detection?.create_response ?? true;
    this.setState("connecting");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`no session after ${CONNECT_TIMEOUT_MS / 1000} s`));
        this.ws.close();
      }, CONNECT_TIMEOUT_MS);
      const ws = (this.ws = this.openSocket());
      ws.addEventListener("open", () => {
        this.flags.open = true;
        this.send({ type: "session.update", session });
      });
      ws.addEventListener("message", (msg) => {
        const event = JSON.parse(msg.data);
        if (event.type === "session.updated" && !this.flags.ready) {
          clearTimeout(timer);
          this.flags.ready = true;
          this.setState("listening");
          resolve(event);
        }
        if (event.type === "error" && !this.flags.ready) reject(new Error(event.error?.message));
        this.receive(event);
      });
      ws.addEventListener("close", (e) => {
        this.flags.open = false;
        this.flags.ready = false;
        clearTimeout(this.keepalive);
        this.setState("closed");
        this.emit("close", { code: e.code, reason: e.reason });
        reject(new Error(`connection closed (${e.code}) ${e.reason || ""}`.trim()));
      });
      ws.addEventListener("error", () => reject(new Error("could not connect to the relay")));
    });
  }

  close() {
    this.ws?.close();
  }

  // ---- Sending ---------------------------------------------------------------------------

  send(event) {
    if (!this.flags.open) return;
    this.ws.send(JSON.stringify(event));
    if (event.type !== "input_audio_buffer.append") this.emit("sent", { event });
    clearTimeout(this.keepalive);
    // An empty update is the cheapest client event: it changes nothing and resets the idle timer.
    this.keepalive = setTimeout(() => this.send({ type: "session.update", session: {} }), KEEPALIVE_AFTER_MS);
  }

  /**
   * Change the session mid-call: a handoff swaps `instructions` and `tools`. Arrays replace,
   * objects merge. Safe at any time, including inside the tool gate.
   */
  update(session) {
    if (session.audio?.input?.turn_detection) this.createResponse = session.audio.input.turn_detection.create_response;
    this.send({ type: "session.update", session });
  }

  /** A typed turn. Queued until the conversation can take it (rules 1 and 4). */
  sendText(text) {
    this.queue.push({ kind: "text", text });
    this.pump();
  }

  /** Ask for a response without adding a turn, e.g. so a new agent speaks first. */
  requestResponse() {
    this.queue.push({ kind: "respond" });
    this.pump();
  }

  /** Caller audio, already in the session's input format, base64-encoded. */
  appendAudio(base64) {
    this.send({ type: "input_audio_buffer.append", audio: base64 });
  }

  cancel() {
    if (this.flags.openResponse) this.send({ type: "response.cancel" });
  }

  canSend() {
    const f = this.flags;
    return f.ready && !f.toolGate && !f.openResponse && !f.pendingCreate && !f.userSpeaking && !f.awaitingAuto;
  }

  pump() {
    while (this.queue.length && this.canSend()) {
      const op = this.queue.shift();
      if (op.kind === "text") {
        this.send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: op.text }] } });
      }
      this.createNow();
    }
    this.updateState();
  }

  createNow() {
    this.flags.pendingCreate++;
    this.send({ type: "response.create" });
    clearTimeout(this.createTimer);
    this.createTimer = setTimeout(() => {
      this.flags.pendingCreate = 0;
      this.pump();
    }, CREATE_WAIT_MS);
  }

  // ---- Receiving ---------------------------------------------------------------------------

  receive(event) {
    const f = this.flags;
    switch (event.type) {
      case "input_audio_buffer.speech_started":
        f.userSpeaking = true;
        break;

      case "input_audio_buffer.speech_stopped":
        f.userSpeaking = false;
        if (this.createResponse) {
          // The server answers a finished turn on its own. Hold typed text until it starts,
          // or give up waiting if it judged the turn empty and says nothing.
          f.awaitingAuto = true;
          clearTimeout(this.autoTimer);
          this.autoTimer = setTimeout(() => {
            f.awaitingAuto = false;
            this.pump();
          }, AUTO_RESPONSE_WAIT_MS);
        }
        break;

      case "input_audio_buffer.committed":
      case "input_audio_buffer.cleared":
        f.userSpeaking = false;
        break;

      case "response.created":
        f.openResponse = event.response.id;
        f.awaitingAuto = false;
        if (f.pendingCreate) f.pendingCreate--;
        if (!f.pendingCreate) clearTimeout(this.createTimer);
        break;

      case "response.output_item.added":
        if (event.item?.type === "function_call") {
          // Rule 1: the call is in the server's history now, so nothing may come between it
          // and its output.
          f.toolGate++;
          const list = this.calls.get(event.response_id) ?? [];
          list.push({ itemId: event.item.id, call_id: event.item.call_id, name: event.item.name, arguments: "" });
          this.calls.set(event.response_id, list);
        }
        break;

      case "response.function_call_arguments.done": {
        const call = (this.calls.get(event.response_id) ?? []).find((c) => c.itemId === event.item_id || c.call_id === event.call_id);
        if (call) {
          call.arguments = event.arguments;
          call.name ??= event.name;
          call.args = parseArgs(event.arguments);
          this.emit("tool.call", { call });
        }
        break;
      }

      case "response.output_text.delta":
        this.onTextDelta(event);
        break;

      case "response.output_text.done":
        this.onTextDone(event.response_id);
        break;

      case "response.done":
        this.onResponseDone(event.response);
        break;

      case "error":
        // A refused response.create leaves nothing to wait for.
        if (f.pendingCreate && /response/i.test(event.error?.message ?? "")) f.pendingCreate--;
        break;
    }
    this.emit(event.type, event);
    this.emit("*", event);
    this.pump();
  }

  async onResponseDone(response) {
    const f = this.flags;
    if (f.openResponse === response.id) f.openResponse = null;
    this.onTextDone(response.id);
    const calls = this.calls.get(response.id) ?? [];
    this.calls.delete(response.id);
    if (!calls.length) return;

    if (response.status !== "completed") {
      // Rule 2: the server dropped these calls with the response. Answering one would put an
      // output in history with no call before it.
      f.toolGate -= calls.length;
      for (const call of calls) this.emit("tool.result", { call, error: "cancelled" });
      this.pump();
      return;
    }

    const outputs = [];
    for (const call of calls) {
      const started = performance.now();
      let result;
      try {
        result = (await this.onToolCall?.(call)) ?? { output: { error: `no handler for '${call.name}'` } };
      } catch (err) {
        result = { output: { error: `${err.name}: ${err.message}` } };
      }
      const output = typeof result.output === "string" ? result.output : JSON.stringify(result.output ?? "");
      outputs.push({ call, output, knowledge: result.knowledge });
      this.emit("tool.result", { call, output: result.output, knowledge: result.knowledge, ms: Math.round(performance.now() - started) });
    }
    for (const { call, output, knowledge } of outputs) {
      const item = { type: "function_call_output", call_id: call.call_id, output }; // rule 3: call_id as given
      if (knowledge?.length) item.poly_knowledge = knowledge;
      this.send({ type: "conversation.item.create", item });
    }
    // The follow-up goes out before anything queued: the gate is still shut until it's sent.
    this.createNow();
    f.toolGate -= calls.length;
    this.pump();
  }

  // ---- Reply text ----------------------------------------------------------------------

  reply(responseId) {
    if (!this.replies.has(responseId)) this.replies.set(responseId, { raw: "", clean: "", tag: null, tagDone: false, done: false });
    return this.replies.get(responseId);
  }

  onTextDelta(event) {
    const r = this.reply(event.response_id);
    r.itemId = event.item_id;
    r.raw += event.delta;
    let clean;
    if (r.tagDone) clean = event.delta;
    else {
      // Hold the start of a reply only while it could still be an emotion tag.
      const head = r.raw.trimStart();
      const m = head.match(/^\[(\w+)\]\s*/);
      if (m) {
        r.tag = m[1];
        r.tagDone = true;
        clean = head.slice(m[0].length);
      } else if (head.startsWith("[") && !head.includes("]") && head.length <= MAX_TAG_HOLD) {
        return;
      } else {
        r.tagDone = true;
        clean = r.raw;
      }
    }
    if (!clean) return;
    r.clean += clean;
    this.emit("agent.delta", { responseId: event.response_id, itemId: r.itemId, delta: clean, text: r.clean, emotion: r.tag });
  }

  onTextDone(responseId) {
    const r = this.replies.get(responseId);
    if (!r || r.done) return;
    if (!r.tagDone && r.raw) {
      r.tagDone = true;
      r.clean = r.raw;
      this.emit("agent.delta", { responseId, itemId: r.itemId, delta: r.raw, text: r.raw });
    }
    r.done = true;
    this.emit("agent.done", { responseId, itemId: r.itemId, text: r.clean, emotion: r.tag });
  }

  // ---- Playback reports ------------------------------------------------------------------
  // Only the page knows what the caller has actually heard. Telling the server keeps its
  // barge-in check running for as long as the reply is audible, and gives the model an
  // account of where the caller cut in.

  playbackStarted(responseId) {
    const r = this.reportFor(responseId);
    if (r.started) return;
    r.started = true;
    this.send({ type: "poly.output_audio.started", response_id: responseId });
  }

  playbackProgress(responseId, audioMs, spokenText) {
    const r = this.reportFor(responseId);
    if (!r.started || r.stopped || spokenText.length <= r.sent) return;
    this.send({ type: "poly.output_audio.delta", response_id: responseId, audio_ms: Math.round(audioMs), delta: spokenText.slice(r.sent) });
    r.sent = spokenText.length;
  }

  playbackStopped(responseId, audioMs, droppedMs, spokenText) {
    const r = this.reportFor(responseId);
    if (!r.started || r.stopped) return;
    r.stopped = true;
    this.send({
      type: "poly.output_audio.stopped",
      response_id: responseId,
      audio_ms: Math.round(audioMs),
      dropped_ms: Math.round(droppedMs),
      spoken_text: spokenText,
    });
  }

  reportFor(responseId) {
    if (!this.reports.has(responseId)) this.reports.set(responseId, { started: false, stopped: false, sent: 0 });
    return this.reports.get(responseId);
  }

  // ---- State -------------------------------------------------------------------------------

  setState(state) {
    if (state === this.state) return;
    this.state = state;
    this.emit("state", { state });
  }

  updateState() {
    if (!this.flags.ready) return;
    const f = this.flags;
    if (f.userSpeaking) this.setState("user_speaking");
    else if (f.openResponse) this.setState("responding");
    else if (f.toolGate || f.pendingCreate || f.awaitingAuto) this.setState("thinking");
    else this.setState("listening");
  }
}

function parseArgs(json) {
  if (!json) return {};
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
