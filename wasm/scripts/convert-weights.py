#!/usr/bin/env python3
"""Convert Meta's htdemucs checkpoint to GGML f16 binary format.

Source checkpoint: Meta Research htdemucs @ 955717e8 (frozen; MIT licence)
  https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/955717e8-8726e21a.th

This script is a thin wrapper around sevagh/demucs.cpp's upstream conversion
script, which is vendored at scripts/convert-pth-to-ggml.py inside that repo.
Run build-wasm.sh first (or clone demucs.cpp separately) and point
DEMUCS_CPP_DIR at it.

The output is:
  <DEST_DIR>/ggml-model-htdemucs-4s-f16.bin  (~80.1 MB)

Its SHA-256 must match the value in dist/model-sha256.ts.

Usage:
  pip install -r requirements.txt
  python convert-weights.py /path/to/output/

Alternatively, download the pre-converted file from the MIT-licensed
Retrobear/demucs.cpp dataset on Hugging Face and verify its SHA-256:
  https://huggingface.co/datasets/Retrobear/demucs.cpp/resolve/main/ggml-model-htdemucs-4s-f16.bin

IMPORTANT: Never use freemusicdemixer's prebuilt .bin — those weights are
explicitly proprietary. This script and the Retrobear dataset both derive from
Meta's MIT-licensed checkpoint.
"""

import hashlib
import os
import subprocess
import sys
from pathlib import Path

# SHA-256 of the canonical ggml-model-htdemucs-4s-f16.bin produced by this
# conversion. The smoke test and app code import this constant from model-sha256.ts.
EXPECTED_SHA256 = "PLACEHOLDER_RUN_CONVERSION_TO_OBTAIN"


def compute_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <dest_dir>", file=sys.stderr)
        sys.exit(1)

    dest_dir = Path(sys.argv[1])
    dest_dir.mkdir(parents=True, exist_ok=True)

    # Refuse to fall back to any prebuilt third-party weights.
    demucs_cpp_dir = os.environ.get("DEMUCS_CPP_DIR", "")
    if not demucs_cpp_dir:
        print(
            "ERROR: DEMUCS_CPP_DIR not set.\n"
            "  Clone sevagh/demucs.cpp and set DEMUCS_CPP_DIR to its path.\n"
            "  The build will NOT fall back to any prebuilt weights.",
            file=sys.stderr,
        )
        sys.exit(1)

    convert_script = Path(demucs_cpp_dir) / "scripts" / "convert-pth-to-ggml.py"
    if not convert_script.exists():
        print(f"ERROR: {convert_script} not found", file=sys.stderr)
        sys.exit(1)

    # The upstream convert-pth-to-ggml.py loads htdemucs via torch.hub.load,
    # which downloads Meta's frozen 955717e8 checkpoint automatically from
    # https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/955717e8-8726e21a.th
    # No checkpoint path argument is needed — the demucs package bakes in the URL.
    print(f"==> Converting htdemucs (955717e8) to GGML f16 in {dest_dir}")
    try:
        subprocess.run(
            [sys.executable, str(convert_script), str(dest_dir)],
            cwd=demucs_cpp_dir,
            check=True,
        )
    except subprocess.CalledProcessError as exc:
        print(f"ERROR: conversion failed (exit code {exc.returncode})", file=sys.stderr)
        sys.exit(1)

    out_bin = dest_dir / "ggml-model-htdemucs-4s-f16.bin"
    if not out_bin.exists():
        print(f"ERROR: expected output not found: {out_bin}", file=sys.stderr)
        sys.exit(1)

    sha = compute_sha256(out_bin)
    print(f"==> SHA-256: {sha}")

    if EXPECTED_SHA256 != "PLACEHOLDER_RUN_CONVERSION_TO_OBTAIN":
        if sha != EXPECTED_SHA256:
            print(
                f"ERROR: SHA-256 mismatch!\n  got:      {sha}\n  expected: {EXPECTED_SHA256}",
                file=sys.stderr,
            )
            sys.exit(1)
        print("==> SHA-256 verified")
    else:
        print(
            f"==> First run — record this SHA-256 in dist/model-sha256.ts:\n"
            f"      {sha}"
        )

    print(f"==> Done: {out_bin} ({out_bin.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
