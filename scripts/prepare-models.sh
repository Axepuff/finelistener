#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/build-assets/models"
MODELS_SRC="$ROOT_DIR/models"

BUNDLED_MODELS=(
    "ggml-base.bin"
    "ggml-silero-v5.1.2.bin"
)

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

for model in "${BUNDLED_MODELS[@]}"; do
    src="$MODELS_SRC/$model"
    if [[ -f "$src" ]]; then
        echo "Copying $model..."
        cp "$src" "$OUTPUT_DIR/"
    else
        echo "Error: Required model $model not found at $src"
        exit 1
    fi
done

echo "Models staged to $OUTPUT_DIR"
ls -lh "$OUTPUT_DIR"
