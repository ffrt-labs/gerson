# 01 — Which browser inference runtime and model artifact?

Type: research
Status: resolved
Blocked by: —

## Question

Gerson must run Demucs separation entirely in the browser. Which runtime and which published model
artifact do we commit to?

Candidates to evaluate:

- `sevagh/free-music-demixer` / `demucs.cpp` — hand-written C++ + Eigen3, compiled to WASM
- `timcsy/demucs-web` — ONNX Runtime Web with WebGPU and WASM backends
- `demucs-onnx` (PyPI) + the ONNX exports on Hugging Face (`StemSplitio/htdemucs-onnx`)
- ONNX Runtime Web directly against an htdemucs export we pin ourselves

Resolve, with numbers, not impressions:

1. **Artifact**: exact model file(s), size on disk, quantisation options, and licence — both the code
   licence and the *weights* licence (Demucs weights have their own terms; confirm they permit this use).
2. **Speed**: wall-clock to separate a 4-minute song on a desktop CPU, and with WebGPU if available.
3. **Memory**: peak RAM during inference, and whether it survives a mobile Safari/Chrome tab.
4. **Threading**: does the fast path need SharedArrayBuffer, and therefore COOP/COEP response headers?
   If yes, that constrains hosting — say so explicitly, it feeds the Distribution fog.
5. **Integration shape**: what the API actually looks like from a Web Worker — can we feed decoded
   PCM in and get 4 PCM buffers out, and can it report progress?
6. **Maintenance risk**: is the project alive, and is the artifact pinned somewhere stable we can cache.

Output a recommendation with a named runner-up and the condition under which we'd switch.

## Answer

**Take `sevagh/demucs.cpp` compiled to WASM ourselves** (`src_wasm/` target is in-tree), driven by N
ordinary Web Workers, against the f16 GGML `htdemucs` 4-source weights — **80.1 MB**, MIT code and MIT
weights, regenerable from Meta's frozen `955717e8` checkpoint. Do **not** reuse freemusicdemixer's
prebuilt `.bin`: its weights are explicitly proprietary.

- **Speed**: ~5 min for a 4-min song at 8 workers (from the published 7-min-song / 9-min figure);
  ~23 min single-worker.
- **Memory**: ~2.3–2.5 GB peak per worker (measured native, Eigen-no-BLAS). Size workers by RAM, not
  cores — the shipped production heuristic is `RAM_GB / 4`, defaulting to 1 worker on mobile.
- **Threading**: **no SharedArrayBuffer, no COOP/COEP.** Parallelism is N independent single-threaded
  WASM instances. *Distribution fog resolves permissively — any static host works.*
- **Integration**: `_modelInit(bytes)` + `_modelDemixSegment(L,R,len, 7×L/R out ptrs, batch)`; PCM in,
  4 PCM buffers out; progress already posted from C++ as `{msg:'PROGRESS_UPDATE', data: 0..1}`.
- **Risk**: upstream last pushed 2024-12-01. Vendor at a pinned commit; deps are only Eigen + C++17.

**Runner-up: ONNX Runtime Web + `StemSplitio/htdemucs-onnx`** (fp16-weights, 158 MB, MIT) — cleaner
single-graph API and a live runtime, but the only measured browser numbers today are 10–15 min/song on
WebGPU and 20–30 min on WASM. **Switch when a measured browser WebGPU run does a 4-min song in under
~4 min**, or if we end up needing COOP/COEP anyway.

Full findings, with numbers and sources: [`../research/01-browser-inference-runtime.md`](../research/01-browser-inference-runtime.md)
