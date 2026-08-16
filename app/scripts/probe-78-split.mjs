/**
 * Node baseline for #78, timing the two halves of codec/flac.ts's `push`
 * separately: the pcmToInt32Interleaved JS loop, and the single wasm
 * process_interleaved call. #77 measured only their sum (1.0 s), which is not
 * enough to say which half Chrome is spinning in.
 *
 *   node scripts/probe-78-split.mjs [durationSec] [rounds] [chunkSec]
 */
import { createRequire } from 'node:module';
createRequire(import.meta.url);

const SAMPLE_RATE = 44100;
const BITS_PER_SAMPLE = 16;
const COMPRESSION_LEVEL = 5;

const durationSec = Number(process.argv[2] ?? 231);
const rounds = Number(process.argv[3] ?? 3);
const chunkSec = Number(process.argv[4] ?? 10);
const n = Math.round(SAMPLE_RATE * durationSec);

const mod = (await import('libflacjs/dist/libflac.js')).default;
const flac = await new Promise((resolve, reject) => {
  if (mod.isReady()) resolve(mod);
  else { mod.on('ready', () => resolve(mod)); mod.on('error', reject); }
});

// Verbatim from codec/flac.ts.
function pcmToInt32Interleaved(channels) {
  const numCh = channels.length;
  const numSamples = channels[0].length;
  const out = new Int32Array(numSamples * numCh);
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const s = Math.round(channels[ch][i] * 32767);
      out[i * numCh + ch] = s < -32768 ? -32768 : s > 32767 ? 32767 : s;
    }
  }
  return out;
}

const left = new Float32Array(n);
const right = new Float32Array(n);
for (let i = 0; i < n; i++) {
  const v = Math.sin(i / 20) * 0.25 + Math.sin(i / 3.1) * 0.05;
  left[i] = v; right[i] = v * 0.9;
}

const ms = (t) => (Number(process.hrtime.bigint() - t) / 1e6).toFixed(1);
const now = () => process.hrtime.bigint();

for (let r = 0; r < rounds; r++) {
  if (chunkSec > 0) {
    const id = flac.create_libflac_encoder(SAMPLE_RATE, 2, BITS_PER_SAMPLE, COMPRESSION_LEVEL);
    flac.init_encoder_stream(id, () => {});
    const chunkSamples = Math.round(chunkSec * SAMPLE_RATE);
    const per = [];
    for (let off = 0; off < n; off += chunkSamples) {
      const end = Math.min(off + chunkSamples, n);
      const a = now();
      const il = pcmToInt32Interleaved([left.subarray(off, end), right.subarray(off, end)]);
      const iMs = ms(a);
      const b = now();
      flac.FLAC__stream_encoder_process_interleaved(id, il, end - off);
      per.push(`${iMs}/${ms(b)}`);
    }
    flac.FLAC__stream_encoder_finish(id);
    flac.FLAC__stream_encoder_delete(id);
    console.log(`r${r} chunked (interleave/wasm ms per ${chunkSec}s chunk):`, per.join('  '));
  }

  const id = flac.create_libflac_encoder(SAMPLE_RATE, 2, BITS_PER_SAMPLE, COMPRESSION_LEVEL);
  let bytes = 0;
  flac.init_encoder_stream(id, (d) => { bytes += d.length; });
  const a = now();
  const il = pcmToInt32Interleaved([left, right]);
  const iMs = ms(a);
  const b = now();
  flac.FLAC__stream_encoder_process_interleaved(id, il, n);
  const wMs = ms(b);
  const c = now();
  flac.FLAC__stream_encoder_finish(id);
  flac.FLAC__stream_encoder_delete(id);
  console.log(`r${r} whole: interleave=${iMs}ms wasm=${wMs}ms finish=${ms(c)}ms flac=${(bytes / 1048576).toFixed(1)}MB`);
}
