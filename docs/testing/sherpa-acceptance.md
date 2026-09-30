# Speaker label acceptance

## Build and release assets

Run the variant's `npm run prebuild:assets:win-cpu`, `npm run prebuild:assets:win-gpu`, or `npm run prebuild:assets:mac` before packaging. `scripts/prepare-sherpa.py` verifies the pinned archive sizes and SHA256 hashes, stages the CPU runtime and float32 models, and writes an asset manifest. The GPU variant also creates `build-assets/release-components/finelistener-sherpa-cuda-v1.13.8-win-x64.zip` and a manifest that pins its release URL, size, SHA256, and extracted files. The release workflow verifies and publishes that ZIP alongside the matching application release; CI publication still needs a live release run. The app does not use a partial or unverified download.

`node scripts/measure-sherpa-installer.cjs win-x64-cpu` and the `win-x64-gpu` variant build paired Squirrel installers from identical code and resources, with sherpa excluded from one package. The reported `additionBytes` must not exceed 200,000,000. Measure macOS from two otherwise identical signed builds on a macOS arm64 host. Record the installed `sherpa` resource size separately.

| Variant | Added Squirrel installer bytes | Installed bundled sherpa bytes | Optional CUDA component |
| --- | ---: | ---: | ---: |
| Windows x64 CPU | 48,907,776 | 64,157,118 | None |
| Windows x64 GPU | 48,907,264 | 64,161,558 | 1,598,117,544-byte ZIP; 2,310,791,595 bytes installed |
| macOS arm64 | Requires macOS build | 77,962,551 staged on Windows | None |

## Native smoke evidence on the implementation host

- Windows x64 CPU binary and models from the packaged `resources/sherpa` ran an offline 56.861-second test WAV from a path containing Cyrillic and spaces, with PATH restricted to the package's CPU directory and Windows system directories. It returned 10 speaker intervals in 9.618 seconds. The CLI requires relative ASCII arguments for models and input from a Unicode working directory; absolute Unicode arguments failed. The service stages per-run ASCII filenames to handle this.
- Windows x64 CUDA ran the same test WAV on an NVIDIA GTX 1070 with driver 581.80 and cuDNN 9.10.2. The native CLI returned 10 intervals in 6.660 seconds. ONNX profiling recorded 2,016 CUDA nodes in segmentation and 25,410 CUDA nodes in embedding. Both stages also had CPU nodes; CUDA execution is established by the CUDA node events, not the provider flags alone.
- The optional CUDA ZIP has SHA256 `b53e2199d04b5e1ecde5e7adf4d40db73edbf1220a3bb5d0404b375cb6db11a5`. Its pinned release URL currently returns HTTP 404 because the matching v1.3.0 release asset has not been published. This is a release gate for the GPU installer; local development can use the verified staged component.

## Remaining release and listening checks

1. Install the CPU package on a Windows machine with no NVIDIA GPU, Python, CUDA Toolkit, or developer PATH entries. Verify microphone-only labels without a model run, imported-file and system-track diarization, selected ranges, Unicode paths, cancellation, and offline use after installation.
2. Publish the pinned CUDA component with the matching application release. On a clean Windows NVIDIA machine without CUDA/cuDNN/MSVC development tools, download through the UI, interrupt and retry the download, run both model stages on CUDA, and confirm CPU fallback after GPU initialization failure. Verify the installed app keeps CPU and CUDA DLLs isolated.
3. Build and sign a macOS arm64 package. Verify CPU diarization, playback, file import, and microphone-only behavior from the installed app.
4. Review representative Russian and English system and imported recordings, including short interruptions and simultaneous speech, plus a two-track microphone/system echo recording. Record speaker-count and assignment errors, processing time, peak memory, and CPU/GPU hardware. Automated correctness tests do not establish audio quality.
