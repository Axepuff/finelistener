#!/usr/bin/env bash
set -euo pipefail

VARIANT="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WHISPER_SRC="$ROOT_DIR/whisper.cpp"
if [[ -z "$VARIANT" ]]; then
    echo "Usage: $0 <mac-arm64|win-x64-gpu|win-x64-cpu>"
    exit 1
fi

if [[ ! -d "$WHISPER_SRC" ]]; then
    echo "Error: whisper.cpp source directory not found at $WHISPER_SRC"
    exit 1
fi

# Output: build-assets/<variant>/whisper/ — basename "whisper" becomes the resource folder name
OUTPUT_DIR="$ROOT_DIR/build-assets/$VARIANT/whisper"
BUILD_DIR="$WHISPER_SRC/build-$VARIANT"

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

case "$VARIANT" in
    mac-arm64)
        echo "Building whisper.cpp for macOS arm64 (Metal)..."
        cmake -S "$WHISPER_SRC" -B "$BUILD_DIR" \
            -DCMAKE_BUILD_TYPE=Release \
            -DGGML_METAL=ON \
            -DCMAKE_OSX_ARCHITECTURES=arm64
        cmake --build "$BUILD_DIR" --config Release -j "$(sysctl -n hw.ncpu)"

        cp "$BUILD_DIR/bin/whisper-server" "$OUTPUT_DIR/"
        # Copy shared libraries
        find "$BUILD_DIR/src" "$BUILD_DIR/ggml/src" -name '*.dylib' -exec cp {} "$OUTPUT_DIR/" \; 2>/dev/null || true
        # Copy Metal shader
        find "$BUILD_DIR" -name '*.metal' -exec cp {} "$OUTPUT_DIR/" \; 2>/dev/null || true
        find "$WHISPER_SRC/ggml/src" -name 'ggml-metal.metal' -exec cp {} "$OUTPUT_DIR/" \; 2>/dev/null || true
        ;;

    win-x64-gpu)
        echo "Building whisper.cpp for Windows x64 (CUDA + Vulkan)..."
        cmake -S "$WHISPER_SRC" -B "$BUILD_DIR" \
            -DCMAKE_BUILD_TYPE=Release \
            -DGGML_CUDA=ON \
            -DGGML_VULKAN=ON
        cmake --build "$BUILD_DIR" --config Release -j "${NUMBER_OF_PROCESSORS:-4}"

        cp "$BUILD_DIR/bin/Release/whisper-server.exe" "$OUTPUT_DIR/" 2>/dev/null \
            || cp "$BUILD_DIR/bin/whisper-server.exe" "$OUTPUT_DIR/"
        # Copy all DLLs (whisper, ggml, CUDA runtime, Vulkan)
        find "$BUILD_DIR" -name '*.dll' -exec cp {} "$OUTPUT_DIR/" \; 2>/dev/null || true
        ;;

    win-x64-cpu)
        echo "Building whisper.cpp for Windows x64 (CPU only)..."
        cmake -S "$WHISPER_SRC" -B "$BUILD_DIR" \
            -DCMAKE_BUILD_TYPE=Release \
            -DGGML_CUDA=OFF \
            -DGGML_VULKAN=OFF
        cmake --build "$BUILD_DIR" --config Release -j "${NUMBER_OF_PROCESSORS:-4}"

        cp "$BUILD_DIR/bin/Release/whisper-server.exe" "$OUTPUT_DIR/" 2>/dev/null \
            || cp "$BUILD_DIR/bin/whisper-server.exe" "$OUTPUT_DIR/"
        find "$BUILD_DIR" -name '*.dll' -exec cp {} "$OUTPUT_DIR/" \; 2>/dev/null || true
        ;;

    *)
        echo "Unknown variant: $VARIANT"
        echo "Valid variants: mac-arm64, win-x64-gpu, win-x64-cpu"
        exit 1
        ;;
esac

echo "Whisper build artifacts staged to $OUTPUT_DIR"
ls -lh "$OUTPUT_DIR"
