// Runs on the audio thread. Resamples the microphone from the device rate (usually 48 kHz)
// to the session's input rate, 16 or 8 kHz, and hands the page PCM16 blocks.
//
// Each output sample is the average of the input samples it covers, which is a cheap
// low-pass filter: enough to keep speech clean when going down to 8 kHz.
class Capture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ratio = sampleRate / options.processorOptions.targetRate;
    this.buf = new Float32Array(0);
    this.next = 0; // position of the next output sample's window start, in `buf`
  }

  process(inputs) {
    const channel = inputs[0][0];
    if (!channel) return true;
    const buf = new Float32Array(this.buf.length + channel.length);
    buf.set(this.buf);
    buf.set(channel, this.buf.length);

    const out = [];
    while (this.next + this.ratio <= buf.length) {
      const a = Math.floor(this.next), b = Math.floor(this.next + this.ratio);
      let sum = 0;
      for (let i = a; i < b; i++) sum += buf[i];
      const s = Math.max(-1, Math.min(1, sum / (b - a || 1)));
      out.push(s < 0 ? s * 0x8000 : s * 0x7fff);
      this.next += this.ratio;
    }
    const used = Math.floor(this.next);
    this.buf = buf.slice(used);
    this.next -= used;

    if (out.length) {
      const pcm = Int16Array.from(out);
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    return true;
  }
}
registerProcessor("capture", Capture);
