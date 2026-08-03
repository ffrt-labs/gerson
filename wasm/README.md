# Gerson — WASM build

This directory contains the reproducible build pipeline for the two artifacts
that the separation engine depends on:

| Artifact | Location | Size | Note |
|---|---|---|---|
| `demucs.js` + `demucs.wasm` | `dist/` | ~640 KB | Committed |
| `ggml-model-htdemucs-4s-f16.bin` | Not in repo | ~80 MB | Built/downloaded separately |
| `model-sha256.ts` | `dist/` | <1 KB | Committed; importable by app |

---

## Building the WASM module

Requires: `git`, `cmake`, `xz-utils`, and the [Emscripten SDK](https://emscripten.org/).

```sh
# Install Emscripten (once)
git clone https://github.com/emscripten-core/emsdk /opt/emsdk
/opt/emsdk/emsdk install latest
/opt/emsdk/emsdk activate latest

# Build (set EMSDK_DIR if you installed elsewhere)
EMSDK_DIR=/opt/emsdk bash wasm/scripts/build-wasm.sh
```

The script:
1. Clones `sevagh/demucs.cpp` at pinned commit `f1206e9adeea103aef4a636b9e62297cf1f8e34e`
2. Verifies the commit hash — fails loudly if it does not match
3. Builds `demucs.js` and `demucs.wasm` with Emscripten
4. Copies them to `wasm/dist/`

**Committed artifacts:** `dist/demucs.js` and `dist/demucs.wasm` are committed
so they can be used without a local Emscripten setup. Rebuild only when the C++
source changes.

---

## Producing the model weights

The model binary is **not committed** to this repo (80 MB, binary).

**Option A — Convert from Meta's checkpoint (canonical)**

Requires Python 3.11+, PyTorch ≥ 2.0.

```sh
# Install Python dependencies
git clone --recurse-submodules https://github.com/sevagh/demucs.cpp /tmp/demucs.cpp-src
cd /tmp/demucs.cpp-src
git checkout f1206e9adeea103aef4a636b9e62297cf1f8e34e
pip install torch torchaudio numpy
pip install -e ./vendor/demucs

# Convert
DEMUCS_CPP_DIR=/tmp/demucs.cpp-src python wasm/scripts/convert-weights.py /path/to/output/
```

Output: `/path/to/output/ggml-model-htdemucs-4s-f16.bin`

**Option B — Download the pre-converted MIT-licensed copy**

The `Retrobear/demucs.cpp` Hugging Face dataset provides the same conversion
under the same MIT licence:

```sh
curl -L -o ggml-model-htdemucs-4s-f16.bin \
  https://huggingface.co/datasets/Retrobear/demucs.cpp/resolve/main/ggml-model-htdemucs-4s-f16.bin
```

**Verify the SHA-256 after either option:**

```sh
sha256sum ggml-model-htdemucs-4s-f16.bin
# must match: 72b17c42d308982ddb5069bc3bf48b81a5aac4cb6516e4366c0fa7cef6df0064
```

The app verifies this hash against `MODEL_SHA256` from `dist/model-sha256.ts`
before loading the model.

---

## WASM API

The module is loaded as a factory function (`libdemucs`):

```js
const Module = await libdemucs({ locateFile: (f) => `/path/to/${f}` });
```

### `_modelInit(modelDataPtr, modelDataSize)`

Loads the GGML binary into the model. Call once before any demixing.

```js
const bytes = new Uint8Array(modelFileBuffer);
const ptr = Module._malloc(bytes.length);
Module.HEAPU8.set(bytes, ptr);
Module._modelInit(ptr, bytes.length);
Module._free(ptr);
```

### `_modelDemixSegment(leftPtr, rightPtr, length, ...14 outPtrs, batchMode)`

Processes one PCM segment (any length; typically 44 100 × 7.8 ≈ 343 980 samples).
Outputs four stereo stem pairs: drums (0), bass (1), other (2), vocals (3).
Slots 4–6 are unused for the 4-source model but must be passed as valid pointers.

Posts `{ msg: 'PROGRESS_UPDATE', data: 0..1 }` to `postMessage` during inference.
The module is single-threaded — no SharedArrayBuffer, no COOP/COEP headers needed.

---

## Running the smoke test

The smoke test verifies the WASM module end-to-end against the model binary.
It does not require a browser — it runs in Node.js.

```sh
node wasm/smoke-test/smoke.mjs /path/to/ggml-model-htdemucs-4s-f16.bin
```

Expected output:
```
WASM module loaded.
Model binary: 84.0 MB
Calling _modelInit…
_modelInit returned.
Calling _modelDemixSegment (44100 samples = 1.0 s)…
...
PASS: stem 0 is non-silent
PASS: stem 1 is non-silent
PASS: stem 2 is non-silent
PASS: stem 3 is non-silent
PASS: received at least one PROGRESS_UPDATE
PASS: PROGRESS_UPDATE messages are monotonically non-decreasing
PASS: final progress ≤ 1.0

All assertions passed.
```

Inference takes several minutes on CPU — this is a correctness test, not a
benchmark. See [PRD §3.1](../PRD.md) for timing context.
