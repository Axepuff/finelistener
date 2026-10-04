# Community-1 acceptance for issue #14

Observed on 2026-10-05 on Windows x64 with GTX 1070. This is a review handoff, with the release gates below still open. Private reference audio, transcripts, screenshots, local profiles, weights and credentials are excluded from Git.

## Implementation and provenance

A–F are integrated into the Electron application: typed worker/projection/atomic-assignment contracts and ADR 0007; pinned private runtime preparation; persisted selected-source audio caches; saved ASR followed by Community-1; exclusive text assignment with separate regular acoustic evidence; consistent Plain Text/Timecodes, grouped and child editing, search, seek, clipboard and TXT export; release component preparation and installer measurement.

Community-1 revision: 3533c8cf8e369892e6b79ff1bf80f7b0286a54ee. Runtime revision: community-1-pyannote4-torch28-r1. Python 3.12, pyannote.audio 4.0.0, torch/torchaudio 2.8.0, TorchCodec 0.7.0. Inference consumes decoded mono 16 kHz waveform input; native TorchCodec decoding is not relied on. The exact artifact acquisition lock is scripts/community-assets.json; release preparation preserves distribution licenses and notices. No production Node dependency was added.

Initial git status was clean. Five commits ahead of origin/main were retained, including Whisper token timestamp repair and bounded CUDA/speaker progress fixes. The PR branch includes this existing work rather than dropping it.

## Repository checks

- npm run typecheck: passed.
- npm run lint: passed.
- npm run test -- --run: 28 files, 207 tests passed.
- npm run build: passed (existing Vite chunk-size warning).
- Targeted synthetic/FFmpeg cases include old and new sessions, source offsets/ranges, empty text, saved opt-out, missing runtime, failed/cancelled/stale speaker output, incomplete ASR retry, original preservation and cached Optimized reuse. Atomic group tests reject invalid members and stale generations without partial persistence. Projection cases cover the 5-second boundary, longer gaps, A/B/A, unknowns, same-name distinct identities, distinct sources, Unicode, punctuation and raw subword boundaries.

## Application evidence

The actual compiled Electron main/preload and built React renderer were exercised with isolated profiles. Commands were sent to the AppContext store of the rendered UI; runtime inference and persisted sessions were real, not fake adapter results. All four recognition jobs saved text before automatic analysis. Auto and exact results were compared as complete exclusive interval lists, excluding generation-scoped identity prefixes only.

| Private reference | Audio mode | Auto speakers | Exact count | Auto/exact intervals | Backend | Regular / exclusive intervals |
| --- | --- | ---: | ---: | --- | --- | ---: |
| First ten-minute recording | Optimized | 3 | 3 | Identical | CUDA | 117 / 106 |
| First ten-minute recording | Original | 3 | 3 | Identical | CUDA | 109 / 96 |
| Second ten-minute recording | Optimized | 2 | 2 | Identical | CUDA | 204 / 202 |
| Second ten-minute recording | Original | 2 | 2 | Identical | CUDA | 210 / 206 |

These are eight application analyses, using the accepted local experiment as the reference. This demonstrates the integrated path and reproducibility of these cases; it is not an accuracy or performance guarantee. Early full-application runs took approximately 122–129 seconds including ASR and repeated integrity checks, so the experiment's approximately 23-second worker timing is not claimed for the application. Subsequent integrity checks cache verified hashes while checking file size and timestamps; fresh process starts still validate assets.

Additional real application checks passed: explicit Original reopened correctly; Plain Text had no inline speaker controls; Timecodes showed 29 derived groups for the second Original case; search highlighted joined speech; timecode click requested the displayed start; selected-mode TXT matched the projection byte for byte; actual clipboard handler emitted matching text/plain and text/html payloads; expanded fragment edit opened and group assignment saved all member corrections. OS clipboard paste was not exercised.

A rerun on CUDA succeeded. Hiding CUDA devices deliberately caused initialization failure, one CPU retry, saved CPU provenance and a visible fallback flag. This is a controlled fallback on a GPU host, not a clean CPU-only-machine check. Real worker cancellation after spawn and an early-stage stop both terminated the process, freed the foreground operation and preserved saved text/results. A short 30-second range was used for these cancellation probes.

Long-file playback exposed Response.blob failing with Failed to fetch although arrayBuffer and AudioContext decoding succeeded. The playback adapter now loads the buffer into WaveSurfer and handles failures/cancellation. Rechecking the approximately 600-second WAV showed media readyState 4 and loading false. This verifies decoding/loading, not audible playback or listening alignment.

## Private runtime and packaging evidence

Fresh private embedded Windows CPU and CUDA runtimes were assembled from pinned archives and wheels, not copied from the experiment venv. Short CPU and CUDA waveform inference passed; a private runtime path containing spaces and Cyrillic characters also passed. The GPU pipeline ran through the actual application. Offline flags and isolated paths were used; clean installed offline restart remains unverified.

| Variant | Matched baseline installer bytes | With component manifest bytes | Added compressed bytes | Bundled component bytes | External download bytes | Installed component bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Windows x64 CPU | 303803904 | 305002496 | 1198592 | 5036913 | 790569792 | 3604719563 |
| Windows x64 GPU | 329346048 | 330547200 | 1201152 | 5044188 | 3088374801 | 7055840865 |

Within each pair, application app.asar SHA-256 was identical. Both additions are below 200000000 bytes. Components are external release-associated assets; the GPU archive is split into three pinned parts smaller than GitHub's individual asset limit. These measurements were completed before the final small playback-loader repair; repeat against the exact final release build before publication. This report does not equate installer construction with installation acceptance.

The build lock covers macOS arm64 CPU as well as both Windows variants. Release CI validates all three manifests and the application release version. No single-platform substitute or Vulkan diarization is introduced.

## Remaining release and listening gates

- macOS arm64: private runtime build/inference, paired installer size, signing/notarization and clean installation require a macOS host.
- Clean Windows CPU-only and GPU installation without Python/SDK: resource resolution, real first-use release download, interrupted download/extraction, repair and installed offline restart remain unverified. Current component assets have not been published; no release was performed.
- Manual native UI walkthrough and clipboard paste: the computer-use capture tool failed on this host. Programmatic real-UI checks above are reported separately.
- New listening acceptance for both recordings/modes, timeline alignment, short interruptions and overlapping speech still requires the listener. Earlier accepted experiment listening is not reused as a new application listening pass.
- Maintainer gated model acquisition in release CI and exact CUDA/cuDNN redistribution/license inventory require final review before publishing GPU artifacts. CC-BY-4.0 model attribution, Python/pyannote/PyTorch notices and wheel license files are retained; no claim of completed proprietary redistribution review is made. Review the exact CUDA libraries against NVIDIA's redistribution attachment and separate cuDNN terms.

Nothing was merged or released.
