/**
 * Times the post-inference stem path that worker.ts runs four times, once per
 * Role, after _modelDemixSegment returns. Replicates codec/flac.ts exactly:
 * pcmToInt32Interleaved, then one process_interleaved call over the whole
 * stem, then finish().
 *
 *   node probe-flac-encode.mjs <durationSec>
 */
import { createRequire } from 'node:module';
const require = createRequire('/Users/freitasfa/Documents/projects/gerson/app/');

const SAMPLE_RATE = 44100;
const BITS_PER_SAMPLE = 16;
const COMPRESSION_LEVEL = 5;
const durationSec = Number(process.argv[2] ?? 231);
const n = Math.round(SAMPLE_RATE * durationSec);

const mod = (await import('libflacjs/dist/libflac.js')).default;
const flac = await new Promise((resolve, reject) => {
  if (mod.isReady()) resolve(mod);
  else { mod.on('ready', () => resolve(mod)); mod.on('error', reject); }
});

const t = (label, fn) => {
  const t0 = Date.now();
  const r = fn();
  const ms = Date.now() - t0;
  console.log(`${label}: ${(ms / 1000).toFixed(1)}s`);
  return [r, ms];
};

// A demucs stem: mostly-quiet audio with structure, like a real separated stem.
const left = new Float32Array(n);
const right = new Float32Array(n);
for (let i = 0; i < n; i++) {
  const v = Math.sin(i / 20) * 0.25 + Math.sin(i / 3.1) * 0.05;
  left[i] = v; right[i] = v * 0.9;
}

const encoderId = flac.create_libflac_encoder(SAMPLE_RATE, 2, BITS_PER_SAMPLE, COMPRESSION_LEVEL);
const chunks = [];
flac.init_encoder_stream(encoderId, (data) => { chunks.push(data.slice()); });

const [interleaved, msInter] = t('pcmToInt32Interleaved', () => {
  const out = new Int32Array(n * 2);
  for (let i = 0; i < n; i++) {
    for (let ch = 0; ch < 2; ch++) {
      const s = Math.round((ch === 0 ? left : right)[i] * 32767);
      out[i * 2 + ch] = s < -32768 ? -32768 : s > 32767 ? 32767 : s;
    }
  }
  return out;
});

const [, msProcess] = t('process_interleaved (one call, whole stem)', () =>
  flac.FLAC__stream_encoder_process_interleaved(encoderId, interleaved, n));

const [, msFinish] = t('finish + concat', () => {
  flac.FLAC__stream_encoder_finish(encoderId);
  flac.FLAC__stream_encoder_delete(encoderId);
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { bytes.set(c, off); off += c.length; }
  return bytes;
});

const perStem = (msInter + msProcess + msFinish) / 1000;
console.log(`\nper stem: ${perStem.toFixed(1)}s | four stems: ${(perStem * 4).toFixed(1)}s = ${(perStem * 4 / 60).toFixed(1)} min`);
console.log(`flac bytes: ${(chunks.reduce((a, c) => a + c.length, 0) / 1048576).toFixed(1)} MB`);
