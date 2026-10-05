import { ulawEncode, alawEncode } from "./g711.js";

/** The input formats the page offers, and the `audio.input.format` each one sends. */
export const INPUT_FORMATS = {
  pcm16: { label: "PCM, 16 kHz", rate: 16000, encode: (pcm) => new Uint8Array(pcm.buffer), format: { type: "audio/pcm", rate: 16000 } },
  pcm8: { label: "PCM, 8 kHz", rate: 8000, encode: (pcm) => new Uint8Array(pcm.buffer), format: { type: "audio/pcm", rate: 8000 } },
  pcmu: { label: "G.711 μ-law, 8 kHz", rate: 8000, encode: ulawEncode, format: { type: "audio/pcmu" } },
  pcma: { label: "G.711 A-law, 8 kHz", rate: 8000, encode: alawEncode, format: { type: "audio/pcma" } },
};

/**
 * Open the microphone and call `onFrame(audio, silence)` every 100 ms: the caller's audio,
 * already in the session's input format and base64-encoded, plus a frame of silence in the
 * same format. And `onLevel(0..1)` for a level meter.
 */
export async function startMic({ format, onFrame, onLevel }) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule(new URL("./capture-worklet.js", import.meta.url));
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "capture", { processorOptions: { targetRate: format.rate } });
  // Some browsers only run a worklet that reaches the output, so give it a silent path there.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(node).connect(mute).connect(ctx.destination);
  ctx.resume();

  const frameSamples = format.rate / 10;
  let blocks = [];
  let count = 0;
  node.port.onmessage = ({ data }) => {
    const block = new Int16Array(data);
    blocks.push(block);
    count += block.length;
    if (count < frameSamples) return;
    const pcm = new Int16Array(count);
    let o = 0;
    for (const b of blocks) {
      pcm.set(b, o);
      o += b.length;
    }
    blocks = [];
    count = 0;
    let sum = 0;
    for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
    onLevel?.(Math.min(1, Math.sqrt(sum / pcm.length) / 6000));
    onFrame(toBase64(format.encode(pcm)), silence);
  };
  // The same 100 ms of silence, in the same format, for when the caller isn't meant to be heard.
  const silence = toBase64(format.encode(new Int16Array(frameSamples)));

  return {
    stop() {
      node.port.onmessage = null;
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
    },
  };
}

export function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
