// Runs on the audio thread. Plays reply audio in order, one reply after another, and counts
// what has actually reached the speakers: playback reports are built from that count.
//
// In:  audio {id, pcm}, end {id}, flush
// Out: started {id}, progress {id, played_ms}, finished {id, played_ms},
//      flushed {replies: [{id, played_ms, dropped_ms}]}
const REPORT_EVERY = sampleRate / 4; // 250 ms between progress reports

class Player extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = []; // [{id, samples, offset}]
    this.replies = new Map(); // id -> {queued, played, ended, started, lastReport}
    this.port.onmessage = ({ data }) => this.onMessage(data);
  }

  reply(id) {
    if (!this.replies.has(id)) this.replies.set(id, { queued: 0, played: 0, ended: false, started: false, lastReport: 0 });
    return this.replies.get(id);
  }

  onMessage(msg) {
    if (msg.type === "audio") {
      const samples = new Int16Array(msg.pcm);
      this.queue.push({ id: msg.id, samples, offset: 0 });
      this.reply(msg.id).queued += samples.length;
    } else if (msg.type === "end") {
      const r = this.reply(msg.id);
      r.ended = true;
      this.maybeFinished(msg.id);
    } else if (msg.type === "flush") {
      const replies = [];
      for (const [id, r] of this.replies) if (r.started) replies.push({ id, played_ms: ms(r.played), dropped_ms: ms(r.queued - r.played) });
      this.queue = [];
      this.replies.clear();
      this.port.postMessage({ type: "flushed", replies });
    }
  }

  maybeFinished(id) {
    const r = this.replies.get(id);
    if (!r || !r.ended || r.played < r.queued) return;
    if (r.started) this.port.postMessage({ type: "finished", id, played_ms: ms(r.played) });
    this.replies.delete(id);
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    let i = 0;
    while (i < out.length && this.queue.length) {
      const head = this.queue[0];
      const r = this.reply(head.id);
      if (!r.started) {
        r.started = true;
        this.port.postMessage({ type: "started", id: head.id });
      }
      const n = Math.min(out.length - i, head.samples.length - head.offset);
      for (let k = 0; k < n; k++) out[i + k] = head.samples[head.offset + k] / 32768;
      i += n;
      head.offset += n;
      r.played += n;
      if (r.played - r.lastReport >= REPORT_EVERY) {
        r.lastReport = r.played;
        this.port.postMessage({ type: "progress", id: head.id, played_ms: ms(r.played) });
      }
      if (head.offset >= head.samples.length) {
        this.queue.shift();
        this.maybeFinished(head.id);
      }
    }
    return true;
  }
}

function ms(samples) {
  return Math.round((samples / sampleRate) * 1000);
}

registerProcessor("player", Player);
