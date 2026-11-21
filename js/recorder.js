// Records a node's output to a stereo 16-bit WAV (max 5 minutes).
// Stereo, so the width of Chorus and Reverb survives in the file.
import { engine } from './engine.js';
export const MAX_SECONDS = 300;

export class Recorder {
  constructor(source, onAutoStop) {
    const ctx = engine.ctx;
    this.sr = ctx.sampleRate; this.left = []; this.right = []; this.length = 0;
    this.sp = ctx.createScriptProcessor(4096, 2, 2);
    this.sp.channelCountMode = 'explicit'; this.sp.channelInterpretation = 'speakers'; // mono sources are copied to both sides
    this.sp.onaudioprocess = e => {
      if (this.stopped) return;
      const b = e.inputBuffer;
      this.left.push(new Float32Array(b.getChannelData(0)));
      this.right.push(new Float32Array(b.getChannelData(b.numberOfChannels > 1 ? 1 : 0)));
      this.length += b.length;
      if (this.length >= MAX_SECONDS * this.sr) onAutoStop && onAutoStop();
    };
    this.source = source;
    source.connect(this.sp); this.sp.connect(ctx.destination); // must reach destination to run; it outputs silence
  }
  get seconds() { return this.length / this.sr; }
  stop() {
    this.stopped = true;
    try { this.source.disconnect(this.sp); } catch (e) {}
    try { this.sp.disconnect(); } catch (e) {}
    return encodeWav(this.left, this.right, this.length, this.sr);
  }
}

function encodeWav(left, right, length, sr) {
  const ch = 2, bytes = length * ch * 2;
  const buf = new ArrayBuffer(44 + bytes), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, bytes, true);
  let o = 44;
  const s16 = x => { x = Math.max(-1, Math.min(1, x)); return x < 0 ? x * 0x8000 : x * 0x7fff; };
  for (let k = 0; k < left.length; k++) {
    const L = left[k], R = right[k];
    for (let i = 0; i < L.length; i++, o += 4) { v.setInt16(o, s16(L[i]), true); v.setInt16(o + 2, s16(R[i]), true); }
  }
  return new Blob([buf], { type: 'audio/wav' });
}
