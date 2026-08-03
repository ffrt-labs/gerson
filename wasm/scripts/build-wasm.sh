#!/usr/bin/env bash
# Reproducible WASM build for demucs.cpp.
#
# Pinned source: sevagh/demucs.cpp @ f1206e9adeea103aef4a636b9e62297cf1f8e34e (2024-12-01)
# Output:        dist/demucs.js  dist/demucs.wasm
#
# Requirements (install once):
#   git, cmake, xz-utils, and the Emscripten SDK (see EMSDK_DIR below)
#
# Emscripten install (one-time):
#   git clone https://github.com/emscripten-core/emsdk /opt/emsdk
#   /opt/emsdk/emsdk install latest
#   /opt/emsdk/emsdk activate latest

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WASM_DIR="$REPO_ROOT/wasm"

PINNED_COMMIT="f1206e9adeea103aef4a636b9e62297cf1f8e34e"
EMSDK_DIR="${EMSDK_DIR:-/opt/emsdk}"
BUILD_DIR="$(mktemp -d)"
SRC_DIR="$BUILD_DIR/demucs.cpp-src"

cleanup() { rm -rf "$BUILD_DIR"; }
trap cleanup EXIT

# Activate Emscripten
if [[ ! -f "$EMSDK_DIR/emsdk_env.sh" ]]; then
  echo "ERROR: Emscripten SDK not found at $EMSDK_DIR" >&2
  echo "  Set EMSDK_DIR or run: git clone https://github.com/emscripten-core/emsdk $EMSDK_DIR" >&2
  exit 1
fi
# shellcheck disable=SC1091
source "$EMSDK_DIR/emsdk_env.sh"

# Clone demucs.cpp at the exact pinned commit — never track the default branch.
echo "==> Cloning sevagh/demucs.cpp at $PINNED_COMMIT"
git clone --recurse-submodules https://github.com/sevagh/demucs.cpp "$SRC_DIR"
cd "$SRC_DIR"
git checkout "$PINNED_COMMIT"
git submodule update --init --recursive

ACTUAL_COMMIT="$(git rev-parse HEAD)"
if [[ "$ACTUAL_COMMIT" != "$PINNED_COMMIT" ]]; then
  echo "ERROR: checked out $ACTUAL_COMMIT, expected $PINNED_COMMIT" >&2
  exit 1
fi

# Patch: export HEAPU8/HEAPF32 so the smoke test and app worker can read WASM
# heap memory.  The upstream CMakeLists.txt only exports FS.
sed -i 's/EXPORTED_RUNTIME_METHODS=\[\\\"FS\\\"\]/EXPORTED_RUNTIME_METHODS=[\\"FS\\",\\"HEAPU8\\",\\"HEAPF32\\"]/' \
  "$SRC_DIR/src_wasm/CMakeLists.txt"

# Build
echo "==> Configuring with emcmake"
mkdir -p build-wasm && cd build-wasm
emcmake cmake -DCMAKE_BUILD_TYPE=Release -DCMAKE_POLICY_VERSION_MINIMUM=3.5 ../src_wasm

echo "==> Building (this takes several minutes)"
make -j"$(nproc)"

# Verify outputs
for f in demucs.js demucs.wasm; do
  [[ -f "$f" ]] || { echo "ERROR: $f not produced" >&2; exit 1; }
done

# Install
echo "==> Installing to $WASM_DIR/dist/"
cp demucs.js demucs.wasm "$WASM_DIR/dist/"

echo "==> Build successful"
ls -lh "$WASM_DIR/dist/demucs.js" "$WASM_DIR/dist/demucs.wasm"
