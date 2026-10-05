/**
 * Speaking the replies. Dialog-RSN-1 answers in text, so the page speaks it, and tells the
 * session what the caller actually heard (playback reports).
 *
 * Two voices with the same interface:
 *   BrowserVoice  - the browser's own speech (Web Speech API). No key needed.
 *   CartesiaVoice - Cartesia's streaming TTS through the relay's /tts socket. Much better
 *                   voices; needs CARTESIA_API_KEY on the server.
 *
 *   push(responseId, delta)   reply text as it streams
 *   finish(responseId)        no more text for this reply
 *   drop(responseId)          the server cancelled this reply: stop it if it's playing
 *   stopAll()                 barge-in: stop everything now
 *
 * Replies play one after another, never over each other: a tool call's spoken filler
 * finishes before the answer that follows it starts.
 */

const words = (text) => text.split(/\s+/).filter(Boolean);

// ---- Browser voice ---------------------------------------------------------------------

export class BrowserVoice {
  constructor({ session, voiceName, onSpeaking }) {
    this.session = session;
    this.onSpeaking = onSpeaking;
    this.replies = new Map(); // id -> {buffer, sentences, spoken, current, startedAt, finished, stopped}
    this.order = [];
    this.dead = new Set(); // replies stopped or dropped: late text for them is ignored
    const pick = () => {
      const voices = speechSynthesis.getVoices();
      this.voice =
        voices.find((v) => v.name === voiceName) ??
        voices.find((v) => v.lang?.startsWith("en") && v.localService && v.default) ??
        voices.find((v) => v.lang?.startsWith("en") && v.localService) ??
        voices.find((v) => v.lang?.startsWith("en"));
    };
    pick();
    speechSynthesis.addEventListener?.("voiceschanged", pick);
  }

  static voices() {
    return speechSynthesis.getVoices().filter((v) => v.lang?.startsWith("en"));
  }

  async start() {
    speechSynthesis.cancel();
  }

  close() {
    speechSynthesis.cancel();
  }

  reply(id) {
    if (this.dead.has(id)) return { stopped: true, sentences: [], buffer: "" };
    if (!this.replies.has(id)) {
      this.replies.set(id, { buffer: "", sentences: [], spoken: "", started: false, startedAt: 0, finished: false, stopped: false, speaking: null });
      this.order.push(id);
    }
    return this.replies.get(id);
  }

  push(id, delta) {
    const r = this.reply(id);
    if (r.stopped) return;
    r.buffer += delta;
    // Speak a sentence at a time, as soon as each one is complete.
    const re = /[^.!?]*[.!?]+["')\]]*\s+/g;
    let m, end = 0;
    while ((m = re.exec(r.buffer))) end = re.lastIndex;
    if (end) {
      r.sentences.push(r.buffer.slice(0, end).trim());
      r.buffer = r.buffer.slice(end);
      this.play();
    }
  }

  finish(id) {
    const r = this.reply(id);
    if (r.stopped) return;
    if (r.buffer.trim()) r.sentences.push(r.buffer.trim());
    r.buffer = "";
    r.finished = true;
    this.play();
  }

  drop(id) {
    this.dead.add(id);
    const r = this.replies.get(id);
    if (!r) return;
    if (r.started) this.stop(r, id);
    else this.forget(id);
    this.play();
  }

  stopAll() {
    for (const id of [...this.order]) {
      this.dead.add(id);
      const r = this.replies.get(id);
      if (r.started) this.stop(r, id);
      else this.forget(id);
    }
    speechSynthesis.cancel();
  }

  stop(r, id) {
    if (r.stopped) return;
    r.stopped = true;
    const unspoken = [r.speaking?.text.slice(r.speaking.charIndex) ?? "", ...r.sentences, r.buffer].join(" ").trim();
    // The browser doesn't say how long the rest would have taken: estimate it from its length.
    this.session.playbackStopped(id, performance.now() - r.startedAt, unspoken.length * 60, r.spoken.trim());
    this.onSpeaking?.({ id, speaking: false, heard: r.spoken.trim(), interrupted: true });
    if (r.speaking) speechSynthesis.cancel();
    this.forget(id);
  }

  forget(id) {
    this.replies.delete(id);
    this.order = this.order.filter((x) => x !== id);
  }

  play() {
    const id = this.order[0];
    if (id === undefined) return;
    const r = this.replies.get(id);
    if (r.speaking) return;
    const text = r.sentences.shift();
    if (text === undefined) {
      if (r.finished) {
        if (r.started) {
          this.session.playbackStopped(id, performance.now() - r.startedAt, 0, r.spoken.trim());
          this.onSpeaking?.({ id, speaking: false, heard: r.spoken.trim() });
        }
        this.forget(id);
        this.play();
      }
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    r.speaking = { text, charIndex: 0 };
    const before = r.spoken;
    u.onstart = () => {
      if (!r.started) {
        r.started = true;
        r.startedAt = performance.now();
        this.session.playbackStarted(id);
        this.onSpeaking?.({ id, speaking: true });
      }
    };
    u.onboundary = (e) => {
      if (e.name !== "word" || r.stopped) return;
      // Everything up to the word now being said counts as heard.
      const upto = text.slice(0, e.charIndex + (e.charLength || words(text.slice(e.charIndex))[0]?.length || 0));
      r.speaking.charIndex = upto.length;
      r.spoken = `${before} ${upto}`.trim();
      this.session.playbackProgress(id, performance.now() - r.startedAt, r.spoken);
    };
    u.onend = () => {
      if (r.stopped) return;
      r.speaking = null;
      r.spoken = `${before} ${text}`.trim();
      this.session.playbackProgress(id, performance.now() - r.startedAt, r.spoken);
      this.play();
    };
    u.onerror = u.onend;
    speechSynthesis.speak(u);
  }
}

// ---- Cartesia voice --------------------------------------------------------------------

const SAMPLE_RATE = 24000;

export const CARTESIA_VOICES = [
  { id: "f786b574-daa5-4673-aa0c-cbe3e8534c02", label: "Katie (US English, female)" },
  { id: "47c38ca4-5f35-497b-b1a3-415245fb35e1", label: "Daniel (US English, male)" },
  { id: "62ae83ad-4f6a-430b-af41-a9bede9286ca", label: "Gemma (British English, female)" },
  { id: "ef191366-f52f-447a-a398-ed8c0f2943a1", label: "Archie (British English, male)" },
];

export class CartesiaVoice {
  constructor({ session, voiceId = CARTESIA_VOICES[0].id, url, onSpeaking }) {
    this.session = session;
    this.url = url;
    this.onSpeaking = onSpeaking;
    this.base = {
      model_id: "sonic-3.6",
      voice: { mode: "id", id: voiceId },
      output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: SAMPLE_RATE },
      language: "en",
      add_timestamps: true,
      // How long Cartesia may wait for more text before speaking what it has. Its default
      // favours prosody over latency; the model streams fast enough that 250 ms is plenty.
      max_buffer_delay_ms: 250,
    };
    this.replies = new Map(); // id -> {held, opened, finished, cancelled, words, chunks, synthDone, started}
    this.order = []; // replies in the order they're played
    this.dead = new Set(); // replies stopped or dropped: late text for them is ignored
  }

  async start() {
    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    await this.ctx.audioWorklet.addModule(new URL("./audio/player-worklet.js", import.meta.url));
    this.player = new AudioWorkletNode(this.ctx, "player");
    this.player.connect(this.ctx.destination);
    this.player.port.onmessage = ({ data }) => this.onPlayer(data);
    // Starts at once inside a click; otherwise as soon as the page gets one. Never wait on it.
    this.ctx.resume();
    await new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.addEventListener("open", resolve);
      this.ws.addEventListener("error", () => reject(new Error("could not reach Cartesia through the relay")));
      this.ws.addEventListener("message", (e) => this.onCartesia(JSON.parse(e.data)));
    });
  }

  close() {
    this.ws?.close();
    this.ctx?.close();
  }

  reply(id) {
    if (this.dead.has(id)) return { cancelled: true };
    if (!this.replies.has(id)) {
      this.replies.set(id, { held: "", opened: false, finished: false, cancelled: false, words: [], chunks: [], synthDone: false, started: false });
      this.order.push(id);
    }
    return this.replies.get(id);
  }

  push(id, delta) {
    const r = this.reply(id);
    if (r.cancelled) return;
    r.held += delta;
    // Send whole words only, and nothing until there's something to say.
    const cut = Math.max(r.held.lastIndexOf(" "), r.held.lastIndexOf("\n"));
    if (cut < 0) return;
    const ready = r.held.slice(0, cut + 1);
    if (!r.opened && !/[a-z0-9]/i.test(ready)) return;
    r.held = r.held.slice(cut + 1);
    this.send(id, r, ready, true);
  }

  finish(id) {
    const r = this.reply(id);
    if (r.cancelled) return;
    r.finished = true;
    if (!r.opened && !/[a-z0-9]/i.test(r.held)) {
      // Nothing to say, e.g. a reply that was only a tool call.
      this.remove(id);
      return;
    }
    this.send(id, r, r.held, false);
    r.held = "";
  }

  send(id, r, transcript, more) {
    r.opened = true;
    this.ws.send(JSON.stringify({ ...this.base, context_id: id, transcript, continue: more }));
  }

  drop(id) {
    this.dead.add(id);
    const r = this.replies.get(id);
    if (!r) return;
    this.cancel(id, r);
    if (this.order[0] === id && r.started) this.player.port.postMessage({ type: "flush" });
    else this.remove(id);
  }

  stopAll() {
    for (const [id, r] of this.replies) this.cancel(id, r);
    // The player answers `flushed` with what played; the stopped reports go out from there.
    this.player?.port.postMessage({ type: "flush" });
  }

  cancel(id, r) {
    this.dead.add(id);
    if (r.cancelled) return;
    r.cancelled = true;
    if (r.opened && !r.synthDone) this.ws.send(JSON.stringify({ context_id: id, cancel: true }));
  }

  remove(id) {
    this.replies.delete(id);
    this.order = this.order.filter((x) => x !== id);
    this.feed();
  }

  /** Hand the player the reply at the front of the line; later replies wait their turn. */
  feed() {
    const id = this.order[0];
    const r = id && this.replies.get(id);
    if (!r) return;
    for (const pcm of r.chunks.splice(0)) this.player.port.postMessage({ type: "audio", id, pcm }, [pcm]);
    if (r.synthDone && !r.endSent) {
      r.endSent = true;
      this.player.port.postMessage({ type: "end", id });
    }
  }

  onCartesia(msg) {
    const id = msg.context_id;
    const r = this.replies.get(id);
    if (!r || r.cancelled) return;
    if (msg.type === "chunk") {
      const bytes = Uint8Array.from(atob(msg.data), (c) => c.charCodeAt(0));
      r.chunks.push(bytes.buffer);
    } else if (msg.type === "timestamps") {
      // Word start times count from the start of the context, in seconds.
      const ts = msg.word_timestamps;
      ts.words.forEach((w, i) => r.words.push({ startMs: ts.start[i] * 1000, word: w }));
    } else if (msg.type === "done" || msg.type === "error") {
      if (msg.type === "error") console.warn("Cartesia:", msg.message ?? msg);
      r.synthDone = true;
    }
    if (this.order[0] === id) this.feed();
  }

  spokenText(id, playedMs) {
    const r = this.replies.get(id);
    return r ? r.words.filter((w) => w.startMs <= playedMs).map((w) => w.word).join(" ") : "";
  }

  onPlayer(msg) {
    if (msg.type === "started") {
      const r = this.replies.get(msg.id);
      if (r) r.started = true;
      this.session.playbackStarted(msg.id);
      this.onSpeaking?.({ id: msg.id, speaking: true });
    } else if (msg.type === "progress") {
      this.session.playbackProgress(msg.id, msg.played_ms, this.spokenText(msg.id, msg.played_ms));
    } else if (msg.type === "finished") {
      const heard = this.spokenText(msg.id, msg.played_ms);
      this.session.playbackStopped(msg.id, msg.played_ms, 0, heard);
      this.onSpeaking?.({ id: msg.id, speaking: false, heard });
      this.remove(msg.id);
    } else if (msg.type === "flushed") {
      for (const { id, played_ms, dropped_ms } of msg.replies) {
        const heard = this.spokenText(id, played_ms);
        this.session.playbackStopped(id, played_ms, dropped_ms, heard);
        this.onSpeaking?.({ id, speaking: false, heard, interrupted: dropped_ms > 0 });
      }
      for (const [id, r] of this.replies) if (r.cancelled) this.remove(id);
    }
  }
}
