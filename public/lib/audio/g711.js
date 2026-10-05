// G.711 encoders, PCM16 in, one byte per sample out. The same codecs a phone network uses:
// μ-law in North America and Japan, A-law almost everywhere else.

const ULAW_SEG_END = [0x3f, 0x7f, 0xff, 0x1ff, 0x3ff, 0x7ff, 0xfff, 0x1fff];
const ALAW_SEG_END = [0x1f, 0x3f, 0x7f, 0xff, 0x1ff, 0x3ff, 0x7ff, 0xfff];

function segment(value, ends) {
  for (let i = 0; i < ends.length; i++) if (value <= ends[i]) return i;
  return ends.length;
}

export function ulawEncode(pcm) {
  const out = new Uint8Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    let v = pcm[i] >> 2;
    let mask = 0xff;
    if (v < 0) {
      v = -v;
      mask = 0x7f;
    }
    v = Math.min(v, 8159) + 0x21;
    const seg = segment(v, ULAW_SEG_END);
    out[i] = (seg >= 8 ? 0x7f : (seg << 4) | ((v >> (seg + 1)) & 0x0f)) ^ mask;
  }
  return out;
}

export function alawEncode(pcm) {
  const out = new Uint8Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    let v = pcm[i] >> 3;
    let mask = 0xd5;
    if (v < 0) {
      v = -v - 1;
      mask = 0x55;
    }
    const seg = segment(v, ALAW_SEG_END);
    const a = seg >= 8 ? 0x7f : (seg << 4) | ((seg < 2 ? v >> 1 : v >> seg) & 0x0f);
    out[i] = a ^ mask;
  }
  return out;
}
