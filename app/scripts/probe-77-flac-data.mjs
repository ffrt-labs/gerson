/**
 * TEMPORARY probe for #77. Delete with the branch.
 *
 * The in-browser run showed `encoder.push` — one whole-stem
 * FLAC__stream_encoder_process_interleaved — spinning for 12+ minutes on a
 * 231 s stem, where probe-flac-encode.mjs times the same call at 1.3 s. The two
 * differ in exactly two ways: the browser's memory state, and the *audio*
 * (a pure synthetic sine there, real separated stem audio here).
 *
 * This isolates the audio. Same call, same length, same process — only the
 * content changes. If real audio is orders of magnitude slower than a sine, the
 * mechanism is the data and has nothing to do with Chrome.
 *
 *   node probe-77-flac-data.mjs
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire('/Users/freitasfa/Documents/projects/gerson/app/');
const SAMPLE_RATE = 44100;
const DURATION = 231;
const N = SAMPLE_RATE * DURATION;

const mod = (await import('libflacjs/dist/libflac.js')).default;
const flac = await new Promise((resolve, reject) => {
  if (mod.isReady()) resolve(mod);
  else { mod.on('ready', () => resolve(mod)); mod.on('error', reject); }
});

// Minimal 16-bit PCM WAV reader — enough for the dev-stems fixtures.
function readWavMono(path) {
  const buf = readFileSync(path);
  let off = 12, dataOff = -1, dataLen = 0, channels = 2;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') channels = buf.readUInt16LE(off + 10);
    if (id === 'data') { dataOff = off + 8; dataLen = size; break; }
    off += 8 + size + (size % 2);
  }
  if (dataOff < 0) throw new Error(`no data chunk in ${path}`);
  const frames = Math.floor(dataLen / 2 / channels);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = buf.readInt16LE(dataOff + i * 2 * channels) / 32768;
  return out;
}

// Exactly codec/flac.ts's pcmToInt32Interleaved.
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

function timeEncode(label, left, right) {
  const t0 = Date.now();
  const interleaved = pcmToInt32Interleaved([left, right]);
  const tInterleave = Date.now() - t0;

  const id = flac.create_libflac_encoder(SAMPLE_RATE, 2, 16, 5);
  let bytes = 0;
  flac.init_encoder_stream(id, (d) => { bytes += d.length; });

  const t1 = Date.now();
  flac.FLAC__stream_encoder_process_interleaved(id, interleaved, left.length);
  const tProcess = Date.now() - t1;

  flac.FLAC__stream_encoder_finish(id);
  flac.FLAC__stream_encoder_delete(id);

  console.log(
    `${label.padEnd(22)} interleave ${(tInterleave / 1000).toFixed(1)}s  ` +
    `process ${(tProcess / 1000).toFixed(1)}s  flac ${(bytes / 1048576).toFixed(1)} MB`,
  );
}

// A pure sine: what probe-flac-encode.mjs and the browser probe both used.
const sine = new Float32Array(N);
for (let i = 0; i < N; i++) sine[i] = Math.sin(i / 20) * 0.3 + Math.sin(i / 3.1) * 0.1;
timeEncode('synthetic sine', sine, sine);

// Real separated stem audio, tiled to the same 231 s length.
for (const role of ['vocals', 'drums', 'bass', 'other']) {
  const src = readWavMono(`/Users/freitasfa/Documents/projects/gerson/app/public/dev-stems/${role}.wav`);
  const tiled = new Float32Array(N);
  for (let i = 0; i < N; i++) tiled[i] = src[i % src.length];
  timeEncode(`real stem: ${role}`, tiled, tiled);
}
