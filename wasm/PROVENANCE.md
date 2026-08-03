# Provenance and Licensing

## WASM module — `dist/demucs.js` + `dist/demucs.wasm`

**Source:** `sevagh/demucs.cpp` — C++17 Demucs inference library  
**Pinned commit:** `f1206e9adeea103aef4a636b9e62297cf1f8e34e` (2024-12-01)  
**Licence:** MIT — https://github.com/sevagh/demucs.cpp/blob/main/LICENSE

**Vendored dependencies (included in the build, not in this repo):**
| Dependency | Licence | Purpose |
|---|---|---|
| [Eigen](https://eigen.tuxfamily.org/) | MPL-2.0 | Linear algebra |
| [ggml](https://github.com/ggerganov/ggml) | MIT | Model file format |

Eigen (MPL-2.0) and ggml (MIT) are both compatible with Gerson's MIT licence.
Neither dependency is distributed as part of this repo; they are fetched during
the WASM build via `--recurse-submodules`.

**Build reproducibility:** `scripts/build-wasm.sh` clones the exact pinned commit,
verifies the resulting commit hash, and fails loudly if it does not match.

---

## Model weights — `ggml-model-htdemucs-4s-f16.bin`

**NOT committed to this repo (~80 MB). Produced and hosted separately.**

**Upstream checkpoint:** Meta Research `htdemucs` @ `955717e8-8726e21a.th`  
**Upstream licence:** MIT  
Reference: https://github.com/facebookresearch/demucs

**Conversion:** `scripts/convert-weights.py` uses the conversion script from the
pinned demucs.cpp source (`scripts/convert-pth-to-ggml.py`) to convert the
torch checkpoint to GGML f16 format.

**Pre-converted reference:** The `Retrobear/demucs.cpp` dataset on Hugging Face
provides the same conversion under the same MIT licence and is acceptable as an
alternative to running the conversion locally:
  https://huggingface.co/datasets/Retrobear/demucs.cpp

**SHA-256 of canonical output:** See `dist/model-sha256.ts`.  
Any weight file downloaded or produced must match this hash before being loaded.

**What is NOT acceptable:** freemusicdemixer's prebuilt `.bin` files. Their
model weights are explicitly proprietary — only their code is MIT. Gerson's
build enforces this by failing loudly if `DEMUCS_CPP_DIR` is not set (the
conversion requires the upstream conversion script; there is no silent fallback).

---

## No COOP/COEP requirement

The WASM module is compiled single-threaded (no SharedArrayBuffer, no Atomics).
It does not require `Cross-Origin-Opener-Policy` or `Cross-Origin-Embedder-Policy`
headers and will work on any static host.
