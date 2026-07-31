# 01 — Browser inference runtime and model artifact

Research for [issue 01](../issues/01-browser-inference-runtime.md). Date: 2026-07-31.
All claims below are sourced from repos, source files, HF APIs and official docs; where a number
could not be found in a primary source it says **not found**.

## TL;DR

**Recommend: `demucs.cpp` compiled to WASM ourselves (`src_wasm/` target), driven by N single-threaded
Web Workers, against the f16 GGML `htdemucs` 4-source weights (80.1 MB), all MIT.**

It is the only candidate with (a) a shipped-in-production browser precedent, (b) numbers in the
right order of magnitude, (c) **no SharedArrayBuffer and therefore no COOP/COEP hosting constraint**,
and (d) a small download. Its costs are a 20-month-stale upstream and a CPU-only ceiling.

**Runner-up: ONNX Runtime Web + `StemSplitio/htdemucs-onnx`.** Better long-term runtime story
(Microsoft-maintained, WebGPU EP under active development, self-contained model with STFT folded in),
but the only *measured browser* numbers available today are 2–3× worse than the demucs.cpp path.
Switch condition below.

---

## 1. Artifact: files, sizes, quantisation, licence

### 1a. The upstream weights

`htdemucs` (Demucs v4 hybrid transformer, 4-source) checkpoint signature is `955717e8`
([`demucs/remote/htdemucs.yaml`](https://github.com/facebookresearch/demucs/blob/main/demucs/remote/htdemucs.yaml)
contains exactly `models: ['955717e8']`), served from
`https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/955717e8-8726e21a.th`.

**Licence.** `facebookresearch/demucs` ships a single MIT `LICENSE` (Meta Platforms) and the README
states verbatim: *"Demucs is released under the MIT license as found in the LICENSE file."*
([README §License](https://github.com/facebookresearch/demucs#license)). A tree listing of the repo
shows **no second licence file and no separate model-licence document** — there is no CC-BY-NC or
non-commercial clause anywhere in the repo. The same MIT-only statement is present as far back as the
`v2` branch. Both independent redistributors of the converted weights (below) declare MIT.

*Honest caveat:* the MIT statement does not use the word "weights". Meta publishes no separate terms,
so the reasonable reading — and the reading every downstream redistributor has taken — is that MIT
covers the checkpoints too. This is inference, not a quoted grant.

**Upstream status:** `facebookresearch/demucs` was **archived 2025-01-01** and is read-only. Défossez's
fork `adefossez/demucs` states *"this project is not actively maintained anymore and only important bug
fixes will be processed."* The weights are frozen, which for our purposes is fine — we pin, not track.

### 1b. GGML artifacts (demucs.cpp path)

From the HF API for [`datasets/Retrobear/demucs.cpp`](https://huggingface.co/datasets/Retrobear/demucs.cpp)
(`license: mit`, last modified 2024-06-09, 2381 downloads), exact byte sizes:

| File | Bytes | MB |
|---|---:|---:|
| `ggml-model-htdemucs-4s-f16.bin` | 83,994,361 | **80.1** |
| `ggml-model-htdemucs-6s-f16.bin` | 54,855,129 | 52.3 |
| `ggml-model-hdemucs_mmi-v3-f16.bin` | 167,294,211 | 159.5 |
| `ggml-model-htdemucs_ft_{vocals,drums,bass,other}-4s-f16.bin` | 83,994,361 each | 80.1 each (320.4 total) |

The dataset card names its weight origins as the `dl.fbaipublicfiles.com/demucs/hybrid_transformer/*.th`
URLs — i.e. these are conversions of the official checkpoints, matching `955717e8`. demucs.cpp also
ships `scripts/convert-pth-to-ggml.py` so we can regenerate the file ourselves and never depend on a
third-party HF account.

**Quantisation:** f16 only. Nothing below f16 is published, and sevagh states in the
[free-music-demixer README](https://github.com/sevagh/free-music-demixer#readme):
*"No quantization: the weights of Demucs v4 htdemucs and htdemucs_6s are 81 MB and 53 MB respectively,
stored as float16. Anything smaller affects the quality of the network, and compression only gets down
to ~70 MB: not worth the extra loading time."*

**Code licence:** `sevagh/demucs.cpp` is MIT. Note that the *pre-built* WASM+weights on
freemusicdemixer.com are **not** usable: that repo's README says *"the AI model weights and other
website assets are proprietary and not covered by the MIT license."* We must build the WASM ourselves
from `demucs.cpp/src_wasm` and use the MIT GGML weights — which the repo explicitly supports.

### 1c. ONNX artifacts

| Artifact | File | MB | Licence | Notes |
|---|---|---:|---|---|
| [`StemSplitio/htdemucs-onnx`](https://huggingface.co/StemSplitio/htdemucs-onnx) | `htdemucs.onnx` | **301.8** (316,446,953 B) | MIT | opset 17, STFT folded in as Conv1d |
| same | `htdemucs_fp16weights.onnx` | **158.0** (165,612,636 B) | MIT | fp16-*stored* weights; card says "same runtime memory / latency" |
| [`timcsy/demucs-web-onnx`](https://huggingface.co/timcsy/demucs-web-onnx) | `htdemucs_embedded.onnx` | ~172 (per README) | MIT | STFT/iSTFT **excluded**, done in JS |
| [`kramp/htdemucs-6s-webgpu-onnx`](https://huggingface.co/kramp/htdemucs-6s-webgpu-onnx) | `htdemucs_6s.onnx` | 284.8 | MIT | 6-stem; constant-folded for WebGPU |

No int8 or 4-bit ONNX export of htdemucs is published anywhere I could find. timcsy's experience report
lists "quantise to ~50 MB" as *future work*, not done.

**The two ONNX families differ in a way that matters.** StemSplitio's export patches
`torch.stft` into a sin/cos `Conv1d` so the graph is `mix (1,2,343980) float32 → stems (1,4,2,343980)`,
stems ordered `[drums, bass, other, vocals]` — one tensor in, one out. timcsy's and sevagh's ONNX
exports both move STFT/iSTFT *outside* the model, so the host has to implement a
bit-exact-to-`torch.stft` radix-2 FFT, reflect padding and the exact `2048 + 1536 = 3584`-sample offset
in JS/C++. timcsy's `EXPERIENCE_REPORT.md` is largely a log of getting that offset right. That is real,
avoidable risk.

---

## 2. Speed

### Native C++ (demucs.cpp), 4-minute song, Ryzen 5950X 16c/32t
From [`.github/PERFORMANCE.md`](https://github.com/sevagh/demucs.cpp/blob/main/.github/PERFORMANCE.md),
verbatim `time` output:

| Configuration | Wall clock |
|---|---:|
| `demucs.cpp.main` single-process, `OMP_NUM_THREADS=16` | **10 m 23 s** |
| `demucs_mt.cpp.main`, 4 std::threads × 4 OMP threads | **4 m 09 s** |
| v3 `hdemucs_mmi` mt, 4 threads | 2 m 36 s |

Same doc's BLAS plots (a short test clip, `gspi_stereo.wav`, so useful only for *relative* comparison):
plain Eigen with no BLAS is ~38.7 s at 1 thread and bottoms out ~33 s; OpenBLAS ~31 s. **The WASM build
uses plain Eigen with no BLAS**, so it sits on the slowest of those curves before you even count the
WASM tax.

### Browser WASM (demucs.cpp), from freemusicdemixer's own README
Numbers as published (CPU **not found** — the README does not state the test machine):

| Track | Length | Config | Wall clock |
|---|---|---|---:|
| Georgia Wonder – Siren | ~7 min | single worker | **~41 min** |
| Georgia Wonder – Siren | ~7 min | **8 workers** | **~9 min** |
| Zeno – Signs | (not stated) | single worker | ~20 min |
| Zeno – Signs | (not stated) | 8 workers, 0.75 s overlap | ~5 min |

Scaling the 7-minute figure linearly (the design is segment-parallel, so this is fair): a **4-minute song
≈ 5 min with 8 workers, ≈ 23 min single-worker**. SDR is essentially unchanged between the 1-worker and
8-worker runs (vocals 7.261 → 7.181 dB, drums 10.629 → 10.695 dB), so the parallel split costs no
audible quality.

### Browser, ONNX Runtime Web
The only *measured browser* numbers from a primary source are the [`kramp/audio-split`
Space](https://huggingface.co/spaces/kramp/audio-split) (last modified 2026-07-02), a deployed
ORT-web + timcsy `demucs-web` app. Its README §Performance:

> **WebGPU** (Chrome / Edge, recent Safari): **~10–15 min for a 3–4 min song**.
> **WASM fallback** (no WebGPU): **20–30 min**.

Its worker source confirms the configuration is honest but constrained —
`ort.env.wasm.numThreads = 1` with the comment *"Single-threaded so we don't require cross-origin
isolation (COOP/COEP), which static Spaces don't set by default"*, and
`executionProviders: ['webgpu', 'wasm']`. So the 20–30 min WASM figure is 1 thread / 1 worker, and is
comparable to demucs.cpp's ~23 min single-worker estimate — **the two WASM CPU paths are roughly
equal per-core**. The damaging number is the WebGPU one: **10–15 min for a 3–4 min song is slower than
demucs.cpp on 8 CPU workers (~5 min)**. WebGPU is not currently a fast path for this model in a browser.

**StemSplitio's published performance is native, not browser**, and must not be read as a browser number.
Their card measures a single 7.8 s segment on an Apple M4 Pro **CPU** via desktop `onnxruntime`:
~1.6 s latency, RTF 0.20 → a 4-minute song ≈ 48 s of pure inference. That is what desktop-native ORT
does; nothing establishes ORT-**web** gets near it, and kramp's deployed Space is direct evidence it
does not.

**WebGPU on a discrete GPU: not found.** No primary source publishes a browser WebGPU htdemucs
benchmark on a dedicated GPU.

---

## 3. Memory

**demucs.cpp, native, measured peak RSS** (from `.github/memory_usage_comparison.png`, read directly):

- Eigen, no BLAS (the configuration the WASM build uses): **2.30 GB at 1 thread, ~2.5 GB at 2+ threads**
- OpenBLAS: flat **~1.82 GB** across 1–32 threads
- AOCL BLIS ~1.87–1.92 GB; MKL ~1.86–2.06 GB

Because the design is segmented (7.8 s Demucs segments), peak memory is roughly independent of song
length — sevagh notes the largest track tested was ~7 minutes "fewer memory issues from segmented design".

**WASM build limits**, from
[`src_wasm/CMakeLists.txt`](https://github.com/sevagh/demucs.cpp/blob/main/src_wasm/CMakeLists.txt):

```
-s ALLOW_MEMORY_GROWTH=1 -s MAXIMUM_MEMORY=4GB -s STACK_SIZE=5MB -s MODULARIZE=1
```

i.e. each module instance may grow to the wasm32 ceiling of 4 GB. `PERFORMANCE.md` states the constraint
explicitly: *"This is to run on Android phones (typically with small amounts of memory, 6-8 GB on
flagships) and in WebAssembly (which has a 4 GB memory limit per module)."*

**The strongest real-world memory evidence** is freemusicdemixer's shipped `web/app.js`, which computes
worker count as `NUM_WORKERS = parseInt(selectedMemoryGB) / 4` — i.e. **one worker per 4 GB of
user-declared RAM**. It defaults to 8 GB (2 workers) on large screens and, when the mobile warning is
visible, forces `4gb` (**1 worker**) and fires a `mobile-lower-mem` analytics event. Its OOM copy is:
*"❌ An error occured. Refresh the page and try again with more memory from 'Advanced' settings."*
So the production budget for this exact code is **~2–2.5 GB actually used, 4 GB provisioned, per worker**.

**ONNX path:** StemSplitio's card reports **~1.1 GB RAM** for `htdemucs.onnx` and identically ~1.1 GB
for the fp16-weights variant (fp16 shrinks the *download*, not the runtime footprint), versus ~4.0 GB
for the 4-model FT bag. Again: native ORT, not ORT-web. ORT-web's own advice for constrained devices is
`enableCpuMemArena: false, enableMemPattern: false` (surfaced by demucs-web as `sessionOptions`).

**Does it survive a mobile Safari/Chrome tab? — Numbers not found.** Neither WebKit nor Chrome publishes
a per-tab memory cap, and I found no primary benchmark of htdemucs on iOS Safari. What *is* primary
evidence: the leading production deployment shows a mobile warning, halves its memory budget to 4 GB and
drops to a single worker on small screens. Treat mobile separation as expected-to-fail, exactly as the
map's "playback-first phone" decision already assumes. Also note the wasm32 4 GB ceiling is an
*address-space* limit; iOS will kill the tab well before that.

---

## 4. Threading, SharedArrayBuffer and COOP/COEP

**This is the sharpest differentiator, and it favours demucs.cpp.**

### demucs.cpp WASM: no SharedArrayBuffer, no COOP/COEP
`PERFORMANCE.md` opens with a warning: *"demucs.cpp library code in ./src **should not use any
threading (e.g. pthread or OpenMP) except through the BLAS interface**. This is because demucs.cpp is
compiled to a single-threaded WebAssembly module in freemusicdemixer.com."* The `src_wasm` link flags
contain **no `-pthread` and no `USE_PTHREADS`**; only `-msimd128` for SIMD. Grepping the entire shipped
`web/*.js` of free-music-demixer for `SharedArrayBuffer` and `crossOriginIsolated` returns **zero hits**.

Parallelism is achieved by spawning N *ordinary* `new Worker("stem-worker.js")`, each of which
`importScripts()` its **own independent** WASM instance and processes a different sub-waveform. No shared
memory is needed because nothing is shared. **Therefore: no COOP/COEP response headers, no
cross-origin-isolation requirement, and no hosting constraint at all.** Any static host works — GitHub
Pages, Netlify, a file server. *This directly unblocks the map's "Distribution" fog: threaded WASM is
**not** required.*

Cost: each worker holds a full ~80 MB weight copy plus ~2 GB of working set, so worker count is bounded
by RAM, not cores.

### ONNX Runtime Web: multi-threading *does* require cross-origin isolation
Official docs
([env flags and session options](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html)):
*"ONNX Runtime Web will perform a check for whether the environment supports multi-threading. Only when
the browser supports WebAssembly multi-threading **and `crossOriginIsolated` mode is enabled**,
multi-threading will be enabled."* Default `numThreads` is `min(navigator.hardwareConcurrency/2, 4)`.
So the fast CPU path needs `Cross-Origin-Opener-Policy: same-origin` +
`Cross-Origin-Embedder-Policy: require-corp` — exactly what timcsy's README says and what kramp's Space
could not have, hence its `numThreads = 1`.

Two further ORT-web constraints worth recording: `env.wasm.proxy` (offload to a worker) **cannot be
combined with the WebGPU EP** ("GPU buffers aren't transferable") and does not work under a restrictive
CSP. A COEP `require-corp` document also breaks any non-CORP cross-origin subresource, which would
complicate loading the model straight from the HF CDN.

**Nothing forces us to accept that**: we could run ORT-web at `numThreads = 1` in N workers, the same
shape as demucs.cpp — but then we are on the 20–30 min/song curve.

---

## 5. Integration shape from a Web Worker

### demucs.cpp — verified against shipped production code
Exported surface, from `src_wasm/CMakeLists.txt`:
`EXPORTED_FUNCTIONS=['_malloc','_free','_modelInit','_modelDemixSegment']`, `EXPORT_NAME='libdemucs'`,
`MODULARIZE=1`. Build output is **`demucs.wasm` 566 KB + `demucs.js` 69 KB** (emcc 3.1.51), per
`src_wasm/README.md`. The signature in `src_wasm/demucs.cpp` is:

```c
void modelInit(char *model_data, int model_data_size);
void modelDemixSegment(const float *left, const float *right, int length,
                       float *left_0, float *right_0, /* ... up to */ float *left_6, float *right_6,
                       bool batch_mode_param);
```

So yes to both halves of the question: **decoded PCM in, 4 (or 6) PCM buffers out, all `Float32Array`
over the WASM heap.** The real worker in `free-music-demixer/web/stem-worker.js` does exactly:
`_malloc` → `HEAPU8.set(weightBytes)` → `_modelInit` → `allocateWasmArray(left/right)` → allocate 6×2
output pointers → `_modelDemixSegment(...)` → copy back into fresh `Float32Array`s → `_free` →
`postMessage(waveforms, transferList)` (transferable, zero-copy back to the main thread).

**Progress is built in.** `src_wasm/demucs.cpp` installs a `demucscpp::ProgressCallback` that calls an
`EM_JS` shim posting `{msg:'PROGRESS_UPDATE', data: progress}` (0–1) straight from C++, plus
`{msg:'WASM_LOG', data: ...}` for stdout/stderr. `app.js` keeps `workerProgress[i]` per worker and
renders the mean. That is precisely the progress surface ticket 07 needs, for free.

Weights are passed **as bytes** (`load_demucs_model_for_wasm(model_data, size, &model)`), not a path —
so the 80 MB blob can come from our own IndexedDB/Cache Storage with no Emscripten FS involvement. That
matters for the offline shell (08) and storage (03).

### ORT-web — also workable, shape depends on which export
`demucs-web` exposes a clean typed API:
`new DemucsProcessor({ort, sessionOptions, onProgress, onLog, onDownloadProgress})`,
`loadModel(string | ArrayBuffer)`, `separate(left: Float32Array, right: Float32Array) →
{drums,bass,other,vocals: {left,right}}`, with
`ProgressInfo {progress, currentSegment, totalSegments}`. It accepts an `ArrayBuffer`, so IndexedDB/Cache
Storage works there too. It runs fine in a plain Worker (kramp's Space does exactly this and transfers
the eight output buffers back zero-copy).

Against a StemSplitio export the raw ORT call is even simpler and we skip the JS STFT entirely:

```js
const t = new ort.Tensor("float32", pcm, [1, 2, 343980]);   // 7.8 s stereo segment
const out = await sess.run({ mix: t });                      // out.stems: (1, 4, 2, 343980)
```

but then overlap-add chunking and progress are ours to write (their `infer.py::separate` is the
reference; ~60 lines).

---

## 6. Maintenance risk

| Project | Created | Last push | Stars | Archived | Read |
|---|---|---|---:|---|---|
| `facebookresearch/demucs` | — | archived **2025-01-01** | — | **yes** | Weights frozen. Fine; we pin. |
| `sevagh/demucs.cpp` | 2023-11-26 | **2024-12-01** | 172 | no | **20 months stale.** 32 commits. Complete and self-contained: no deps but Eigen, WASM target in-tree. Dead-but-finished, not dead-and-broken. |
| `sevagh/free-music-demixer` | 2023-07-11 | 2025-04-26 | 357 | **yes** | Archived snapshot; weights proprietary. Useful as a **reference implementation only**. |
| `sevagh/demucs.onnx` | 2024-11-03 | **2026-02-08** | 64 | no | sevagh's own successor. But **no Emscripten/WASM build script in-tree** (only `scripts/build-ort-linux.sh`), so the `demucs_onnx_simd.wasm` shipped on his site is **not reproducible from the public repo**. |
| `timcsy/demucs-web` | 2025-11-30 | **2025-12-01** | 21 | no | **4 commits, one day of work, 8 months stale.** README is Chinese-only. A one-shot port. |
| `StemSplit/demucs-onnx` | **2026-05-22** | **2026-05-22** | 4 | no | **~10 weeks old, one day of commits, 4 stars.** No independent verification. |
| `microsoft/onnxruntime` | — | v1.28.0 **2026-07-25** | — | no | Very much alive. WebGPU EP now a separately versioned plugin (`plugin-ep-webgpu/v0.2.1`, 2026-07-30). |

**Watch-outs on StemSplit.** The HF card and repo README are heavily marketed and end in a
*"Skip the infrastructure — use the StemSplit API"* upsell with pricing links. The artifacts are MIT and
pinned on HF (immutable by revision SHA), and the export is technically credible — the four documented
`torch.onnx.export` blockers match exactly what sevagh independently hit. But the OSS repo is a
lead-generation surface for a paid API, and paid-API vendors have an incentive to make the
run-it-yourself path second-class. Do not depend on their *repo*; if we use them, pin the **HF blob
SHA** and mirror it.

**Pinning and caching.** Whichever we choose, the model is a single immutable blob we can pin by SHA-256:
- GGML htdemucs-4s-f16: `72b17c42d308982ddb5069bc3bf48b81a5aac4cb6516e4366c0fa7cef6df0064` (83,994,361 B)
- `htdemucs.onnx`: `68d0bf16428ef66e692cdff8a9ccf28f1ef3f69440d57e58605a4cc55fcc5e74` (316,446,953 B)
- `htdemucs_fp16weights.onnx`: `d05c269d0178d2a72ad484b10b11dd370193fc923201c3b27a99f848745db70a`

HF resolve URLs are stable per revision. kramp's Space demonstrates the caching pattern we want
(`caches.open('demucs-model-v1')` → `cache.match(url)` → download once → `cache.put`), and the GGML path
lets us regenerate the blob from the frozen Meta checkpoint with `convert-pth-to-ggml.py` if HF ever
disappears. **We should self-host the blob rather than fetch from HF at runtime** — the map's
offline-first constraint plus COEP/CORP awkwardness both point the same way.

---

## 7. Recommendation

### Take: demucs.cpp WASM, self-built, N workers, GGML f16 htdemucs 4s (80.1 MB)

1. **Fastest measured browser path.** ~5 min for a 4-minute song at 8 workers (extrapolated from the
   7-min/9-min published figure), vs 10–15 min for the best measured ORT-web WebGPU result.
2. **No COOP/COEP.** Deployable to any static host. Resolves the Distribution fog in the permissive
   direction; do not let a later decision quietly re-introduce a header requirement.
3. **Smallest download by 2–4×:** 80.1 MB + 0.6 MB wasm, vs 158–302 MB of ONNX. For a PWA that must
   cache the model offline, on a first run the user is already told is slow, this is the single biggest
   UX lever.
4. **Progress and the exact worker protocol already exist** in code we can read
   (`stem-worker.js` + `src_wasm/demucs.cpp`), including the per-worker progress fan-in.
5. **Clean licensing:** MIT code, MIT weights, both regenerable from the frozen Meta checkpoint. We must
   build the WASM ourselves and must *not* reuse freemusicdemixer's proprietary `.bin`.

**Accepted costs, stated plainly:**
- Upstream is 20 months stale. Mitigation: the dependency surface is Eigen + C++17; vendor the repo at a
  pinned commit and treat it as our source, not as a package.
- We own an Emscripten build step (emcc 3.1.51-era flags are in-tree and known-good). Build once, commit
  the `demucs.wasm`/`demucs.js` artifacts.
- CPU only; no WebGPU upside ever on this path.
- ~2–2.5 GB per worker. Worker count must be RAM-derived, not core-derived — copy freemusicdemixer's
  `RAM_GB / 4` heuristic, default 2 workers desktop, 1 on mobile.

### Runner-up: ONNX Runtime Web + `StemSplitio/htdemucs-onnx` (fp16-weights, 158 MB)

Preferred *if* we ever need it: single self-contained graph (`mix → stems`, no hand-written JS STFT),
a runtime Microsoft actively maintains, and a WebGPU ceiling that rises every ORT release. Note the
kramp precedent that the STFT `ConstantOfShape` node must be **constant-folded offline** before ORT-web's
WebGPU backend will accept it — kramp did this for the 6-stem model; the same fold would need doing for
the 4-stem `htdemucs.onnx`, and that is a one-off offline step, not a runtime problem.

### Switch condition

**Switch to ORT-web if a measured browser WebGPU run separates a 4-minute song in under ~4 minutes**
on a mid-range desktop GPU — i.e. beats the demucs.cpp 8-worker CPU path with fewer workers and less RAM.
Concretely, re-test when any of these becomes true:

- A published ORT-web WebGPU htdemucs benchmark beats ~4 min/4-min-song (today's best primary evidence is
  10–15 min, ~3× short).
- We find we need COOP/COEP anyway for an unrelated reason, removing the hosting advantage.
- The demucs.cpp WASM build stops compiling against a current emsdk and fixing it costs more than porting.

Cheapest way to settle it: 30 minutes with kramp's Space or timcsy's demo on the target hardware, timing
a real 4-minute file. That is a prototype-ticket-sized task, not a research one.

---

## Sources

- https://github.com/facebookresearch/demucs (README §License, LICENSE, `demucs/remote/htdemucs.yaml`, archived 2025-01-01)
- https://github.com/sevagh/demucs.cpp — README, `.github/PERFORMANCE.md`, `.github/memory_usage_comparison.png`, `.github/wall_time_comparison.png`, `src_wasm/README.md`, `src_wasm/CMakeLists.txt`, `src_wasm/demucs.cpp`, `scripts/run_benchmarks.sh`
- https://github.com/sevagh/free-music-demixer — README, `web/stem-worker.js`, `web/app.js`, `web/service-worker.js` (archived)
- https://github.com/sevagh/demucs.onnx — README
- https://huggingface.co/datasets/Retrobear/demucs.cpp (+ HF API `?blobs=true` for byte sizes and SHA-256)
- https://huggingface.co/StemSplitio/htdemucs-onnx (model card + HF API)
- https://github.com/StemSplit/demucs-onnx — README; https://pypi.org/project/demucs-onnx/ (0.3.4, 2026-05-22)
- https://github.com/timcsy/demucs-web — README, `EXPERIENCE_REPORT.md`; https://huggingface.co/timcsy/demucs-web-onnx
- https://huggingface.co/kramp/htdemucs-6s-webgpu-onnx (model card)
- https://huggingface.co/spaces/kramp/audio-split — README §Performance, `src/lib/separator.worker.js`
- https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html
- https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html
- https://github.com/microsoft/onnxruntime/blob/main/js/web/docs/webgpu-operators.md
- https://github.com/microsoft/onnxruntime/releases (v1.28.0 2026-07-25; `plugin-ep-webgpu/v0.2.1` 2026-07-30)
