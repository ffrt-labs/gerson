# 01 — Which browser inference runtime and model artifact?

Type: research
Status: open
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
