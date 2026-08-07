import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const modelPath = fileURLToPath(new URL('../public/model/ggml-model-htdemucs-4s-f16.bin', import.meta.url));

if (existsSync(modelPath)) {
  process.exit(0);
}

const shaSourcePath = fileURLToPath(new URL('../../wasm/dist/model-sha256.ts', import.meta.url));
const shaSource = readFileSync(shaSourcePath, 'utf8');
const expectedSha256 = shaSource.match(/"([0-9a-f]{64})"/)?.[1] ?? '<see wasm/dist/model-sha256.ts>';

console.warn(`
Warning: separation model not found at app/public/model/ggml-model-htdemucs-4s-f16.bin

The in-app download popup will fail with a hash-mismatch error until this file
is in place (see wasm/README.md, "Producing the model weights").

Quickest fix - download the pre-converted copy and verify it:

  curl -L -o ggml-model-htdemucs-4s-f16.bin \\
    https://huggingface.co/datasets/Retrobear/demucs.cpp/resolve/main/ggml-model-htdemucs-4s-f16.bin
  sha256sum ggml-model-htdemucs-4s-f16.bin
  # must equal: ${expectedSha256}
  mv ggml-model-htdemucs-4s-f16.bin app/public/model/
`);
