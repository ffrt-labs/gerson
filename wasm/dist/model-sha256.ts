/**
 * SHA-256 of ggml-model-htdemucs-4s-f16.bin — the authoritative value.
 *
 * Produced by converting Meta's htdemucs checkpoint (955717e8-8726e21a.th)
 * to GGML f16 using sevagh/demucs.cpp scripts/convert-pth-to-ggml.py at
 * commit f1206e9adeea103aef4a636b9e62297cf1f8e34e.
 *
 * Verified against: Retrobear/demucs.cpp on HuggingFace (MIT licence).
 *
 * The model download step must verify the fetched binary against this value
 * before passing bytes to _modelInit. See wasm/README.md for how to produce
 * or download the model file.
 */
export const MODEL_SHA256 =
  "72b17c42d308982ddb5069bc3bf48b81a5aac4cb6516e4366c0fa7cef6df0064";
