/**
 * Smoke test: demucs.wasm + htdemucs model weights
 *
 * Verifies:
 *   - _modelInit accepts the model binary without crashing
 *   - _modelDemixSegment produces four non-silent PCM pairs
 *   - PROGRESS_UPDATE messages are received and are monotonically increasing
 *     within the segment
 *   - The module runs with no COOP/COEP headers (it runs in plain Node.js,
 *     which has no SharedArrayBuffer requirements enforced)
 *
 * Usage:
 *   node smoke.mjs <path-to-ggml-model-htdemucs-4s-f16.bin>
 *
 * The model file is NOT committed to the repo (~80 MB). Produce it with:
 *   wasm/scripts/convert-weights.py  (from Meta's 955717e8 checkpoint)
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── progress capture ─────────────────────────────────────────────────────────

const progressUpdates = [];

// The EM_JS sendProgressUpdate function calls postMessage({msg:'PROGRESS_UPDATE', data}).
// In Node.js there is no global postMessage; provide one so the WASM can call it.
globalThis.postMessage = (msg) => {
  if (msg?.msg === "PROGRESS_UPDATE") {
    progressUpdates.push(msg.data);
  }
};

// ── load WASM module ─────────────────────────────────────────────────────────

const wasmDir = path.resolve(__dirname, "../dist");
const { default: createModule } = await import(
  path.join(wasmDir, "demucs.js")
);

const Module = await createModule({
  locateFile: (file) => path.join(wasmDir, file),
});

console.log("WASM module loaded.");

// ── load model binary ────────────────────────────────────────────────────────

const modelPath = process.argv[2];
if (!modelPath) {
  console.error(
    "Usage: node smoke.mjs <path-to-ggml-model-htdemucs-4s-f16.bin>"
  );
  process.exit(1);
}

const modelBytes = readFileSync(modelPath);
console.log(`Model binary: ${(modelBytes.length / 1e6).toFixed(1)} MB`);

// ── _modelInit ───────────────────────────────────────────────────────────────

console.log("Calling _modelInit…");
const modelPtr = Module._malloc(modelBytes.length);
Module.HEAPU8.set(modelBytes, modelPtr);
Module._modelInit(modelPtr, modelBytes.length);
Module._free(modelPtr);
console.log("_modelInit returned.");

// ── build input PCM ──────────────────────────────────────────────────────────

// One second of stereo audio at 44 100 Hz.
// Use a 440 Hz sine + 220 Hz sine mix so energy is spread; demucs can
// classify it arbitrarily, but the convolution guarantees non-silent outputs.
const SR = 44100;
const N = SR; // 1 s — short enough for a quick smoke run
const omega1 = (2 * Math.PI * 440) / SR;
const omega2 = (2 * Math.PI * 220) / SR;

const leftIn = new Float32Array(N);
const rightIn = new Float32Array(N);
for (let i = 0; i < N; i++) {
  const s = 0.5 * Math.sin(omega1 * i) + 0.5 * Math.sin(omega2 * i);
  leftIn[i] = s;
  rightIn[i] = s * 0.9; // slight channel difference
}

// ── allocate WASM heap buffers ────────────────────────────────────────────────

// Emscripten guarantees 4-byte alignment for _malloc; right-shift is idiomatic.
const f32idx = (ptr) => ptr >>> 2;

function allocWasmF32(n) {
  const ptr = Module._malloc(n * 4);
  Module.HEAPF32.fill(0, f32idx(ptr), f32idx(ptr) + n);
  return ptr;
}

const ptrLeftIn  = allocWasmF32(N);
const ptrRightIn = allocWasmF32(N);

Module.HEAPF32.set(leftIn,  f32idx(ptrLeftIn));
Module.HEAPF32.set(rightIn, f32idx(ptrRightIn));

// 7 output pairs (4-source uses [0..3], slots [4..6] are unused but required)
const outPtrs = Array.from({ length: 14 }, () => allocWasmF32(N));

// ── _modelDemixSegment ───────────────────────────────────────────────────────

console.log(`Calling _modelDemixSegment (${N} samples = ${(N / SR).toFixed(1)} s)…`);
console.log("This may take several minutes on CPU.");
progressUpdates.length = 0;

Module._modelDemixSegment(
  ptrLeftIn, ptrRightIn, N,
  outPtrs[0],  outPtrs[1],  // stem 0: drums
  outPtrs[2],  outPtrs[3],  // stem 1: bass
  outPtrs[4],  outPtrs[5],  // stem 2: other
  outPtrs[6],  outPtrs[7],  // stem 3: vocals
  outPtrs[8],  outPtrs[9],  // (unused)
  outPtrs[10], outPtrs[11], // (unused)
  outPtrs[12], outPtrs[13], // (unused)
  false // batch_mode = false
);

console.log(`_modelDemixSegment returned. Progress updates received: ${progressUpdates.length}`);

// ── assertions ───────────────────────────────────────────────────────────────

let failures = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
  } else {
    console.log(`PASS: ${msg}`);
  }
}

function rms(ptr, n) {
  let sum = 0;
  const base = f32idx(ptr);
  for (let i = 0; i < n; i++) {
    const v = Module.HEAPF32[base + i];
    sum += v * v;
  }
  return Math.sqrt(sum / n);
}

// Four non-silent stems (pairs 0–3)
for (let stem = 0; stem < 4; stem++) {
  const lRms = rms(outPtrs[stem * 2],     N);
  const rRms = rms(outPtrs[stem * 2 + 1], N);
  const energy = Math.max(lRms, rRms);
  assert(energy > 1e-6, `stem ${stem} is non-silent (RMS=${energy.toExponential(3)})`);
}

// PROGRESS_UPDATE messages received
assert(progressUpdates.length > 0, `received at least one PROGRESS_UPDATE`);

// Monotonically increasing within the segment
let monotonic = true;
for (let i = 1; i < progressUpdates.length; i++) {
  if (progressUpdates[i] < progressUpdates[i - 1]) {
    monotonic = false;
    break;
  }
}
assert(monotonic, `PROGRESS_UPDATE messages are monotonically non-decreasing`);

// Final progress ≤ 1.0
const lastProgress = progressUpdates.at(-1) ?? 0;
assert(lastProgress <= 1.0, `final progress ≤ 1.0 (got ${lastProgress})`);

// ── summary ──────────────────────────────────────────────────────────────────

if (failures === 0) {
  console.log("\nAll assertions passed.");
} else {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
