#!/usr/bin/env bash
set -euo pipefail

VARIANT="${1:-}"
if [[ -z "$VARIANT" ]]; then
    echo "Usage: $0 <win-x64-gpu|win-x64-cpu>"
    exit 1
fi
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MINIAUDIO_SRC="$ROOT_DIR/miniaudio-loopback"
# Output: build-assets/<variant>/miniaudio-loopback/ — basename becomes resource folder name
OUTPUT_DIR="$ROOT_DIR/build-assets/$VARIANT/miniaudio-loopback"

if [[ ! -d "$MINIAUDIO_SRC" ]]; then
    echo "Error: miniaudio-loopback source directory not found at $MINIAUDIO_SRC"
    exit 1
fi

BUILD_DIR="$MINIAUDIO_SRC/build"

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

echo "Building miniaudio-loopback for Windows x64..."
cmake -S "$MINIAUDIO_SRC" -B "$BUILD_DIR" -DCMAKE_BUILD_TYPE=Release
cmake --build "$BUILD_DIR" --config Release

# Copy binary (handle both Release subfolder and flat layout)
if [[ -f "$BUILD_DIR/Release/miniaudio-loopback.exe" ]]; then
    cp "$BUILD_DIR/Release/miniaudio-loopback.exe" "$OUTPUT_DIR/"
elif [[ -f "$BUILD_DIR/miniaudio-loopback.exe" ]]; then
    cp "$BUILD_DIR/miniaudio-loopback.exe" "$OUTPUT_DIR/"
elif [[ -f "$MINIAUDIO_SRC/bin/miniaudio-loopback.exe" ]]; then
    cp "$MINIAUDIO_SRC/bin/miniaudio-loopback.exe" "$OUTPUT_DIR/"
else
    echo "Error: Could not find miniaudio-loopback.exe after build"
    exit 1
fi

echo "MiniAudio build artifacts staged to $OUTPUT_DIR"
ls -lh "$OUTPUT_DIR"
