# Nemotron integration acceptance — issue #17

Observed on Windows x64 with an NVIDIA GeForce GTX 1070 on 2026-11-12. Private audio, transcripts and generated binaries remain under ignored `.artifact-work/` and `build-assets/`; they are not repository fixtures.

## CPU and Apple Silicon extension

The current implementation uses Nemotron only. The r2 component lock provides Windows CPU, Windows Vulkan (also CPU-capable), and Apple Silicon Metal (also CPU-capable) runtimes. Auto chooses an available GPU before inference, otherwise CPU; the persisted CPU option forces CPU on either GPU build. Explicit GPU failures preserve prior results and require an explicit retry. Community and sherpa code, workers, acquisition locks and release resources are removed; only old saved-session provenance remains readable.

All three locally prepared archives passed `scripts/verify-speaker-release.py --all`: Windows CPU 109,991,717 bytes, Vulkan 123,672,110 bytes, Metal 117,144,255 bytes. The native tar installer extracted the Windows archives into a path with spaces and Cyrillic characters. `scripts/smoke-nemotron.py` passed CPU on both Windows distributions and Vulkan on the GPU distribution. CPU checks used three seconds of synthetic audio, with no timing benchmark or long recording.

After the extension, typecheck, lint, build, all 247 unit tests and 17 Storybook tests passed. Added adapter cases exercise CPU-only systems, forcing CPU despite an available GPU, Metal selection, and Auto without a GPU. The workflow range test verifies actual CPU provenance and offsets once. Renderer tests cover capturing the compute preference before recognition; the Storybook interaction changes CPU selection and verifies it survives closing/reopening settings. The PR's Nemotron components workflow prepares and smoke-tests all three runtimes on their target OS. Hosted CI without an accelerator must explicitly report a skipped GPU smoke; it does not qualify Metal performance on a physical Mac.

The measurements below document the earlier Windows Vulkan r1 integration. Their CPU/macOS exclusions describe that earlier scope and are not the current product support matrix. Full-recording GPU performance, packaged IPC and paired installer figures were measured on that integration build, not on a macOS host.

## Pinned component

The lock in `scripts/nemotron-assets.json` pins NeMo-Speech.cpp 0.3.0 Vulkan (22,417,032-byte upstream archive, SHA-256 `72b3b8b41bfe2be0320eff4e9d310594e4f99deefcde4a157799a039656963ce`) and the 107,012,128-byte Q8 model (SHA-256 `08456d9e22cd9a323c0364d98375f3746d6e68507ebb705cd46438c534c7a3a1`). The model revision is `52a432672732425e4c19765b9fec9b5810e6f4ba`. The UTF-8 manifest modification is recorded as runtime revision `nemo-speech-0.3.0+utf8.1`; component manifests hash the modified executable and all DLLs, model files and notices separately.

The locally generated component archive is 123,671,929 bytes; installed files total 177,978,483 bytes. Neither figure is an installer measurement. The installer bundles only the component manifest and notices.

Matched Squirrel installers measured 343,337,984 bytes without the speaker resource and 343,378,944 bytes with it: **40,960 bytes added**, below the 200,000,000-byte limit. Bundled manifest/notices total 115,752 bytes. Both builds have identical `app.asar` SHA-256 `aa315be540b8dbbbac07453b09c243182fbf6dde30deb3d4cd1b67b3ec703973`. An initial pair differed only in a concurrently updated Vitest cache; the baseline was rebuilt after tests stopped and the equality guard then passed. Evidence: `.artifact-work/nemotron-integration-17/installer-measurement.json` and `build-assets/installer-measurements/win-x64-gpu/1794439817690/`.

## Real GPU checks

The compiled application service selected Vulkan device 0 via the native doctor command. Short and full inputs were analyzed in one CLI invocation each, with no CPU retry:

| Input | Duration | Service wall time | Native inference | Intervals | Labels |
| --- | ---: | ---: | ---: | ---: | ---: |
| Short private sample | 30 s | 0.575 s | 0.400 s | 7 | 2 |
| Full optimized private recording | 4,101.397 s | 20.288 s | 19.650 s | 864 | 2 |

Both interval arrays exactly matched the prior standalone CLI results for the same WAV inputs. This establishes adapter parity, not a new listening assessment or DER score. The full input was already optimized: the service measurement includes segment preparation but excludes the earlier decode/optimization from the original file. A real full-file cancellation stopped the process and removed its working output. A separate run passed with both the runtime directory and input filename containing Cyrillic and CJK characters.

Local evidence: `.artifact-work/nemotron-integration-17/service-checks.json`, `unicode-check.json`, and the corresponding bounded service logs. No private transcript text belongs in this report.

## Installation and packaged application

The production component service passed first install with real ZIP listing/extraction and per-file hashes, offline reuse/inference, cancelled-download cleanup, rejection of a corrupted archive, detection of a modified installed model and atomic repair. The test substituted a local archive stream only at the HTTPS response boundary; it did not verify a published GitHub download. Packaged resource lookup was exercised without the development runtime path. Evidence: `assets-check.json` in the same private artifact directory.

The actual packaged executable then ran with a separate test profile and the verified installed component. Its real preload IPC completed standalone analysis in about 1.02 seconds, preserved raw text, and retained saved labels when an unsupported exact count was rejected. Whisper base recognized the 30-second sample in about 0.90 seconds and saved 13 segments before native analysis; the following Nemotron run persisted 7 intervals and Vulkan provenance. Evidence: `packaged-api-check.json`. These checks exercise packaged main/preload services; automatic renderer coordination is covered by store tests, while UI presentation was checked separately in Storybook. They do not claim a fresh OS install or a complete manual UI walkthrough of the packaged executable.

## Automated coverage and UI

Native adapter tests cover the doctor capability check, pinned GPU arguments, no CPU retry, overlapping/non-dense labels, empty output, malformed and out-of-range segments, and cleanup. Workflow tests cover selected system ranges and offsets, microphone bypass, unsupported counts before preparation/save, cancellation, stale recognition and preservation of saved transcripts. Shared mapping tests retain conservative Unknown outcomes, raw spans, corrections and merges. IPC tests ensure technical paths stay in logs while only safe error codes reach the renderer.

Storybook covers Native settings, component download, phase-only analysis/cancel and GPU errors. Browser inspection verified settings, saved backend, download progress/cancel and a safe error while saved text stays visible. Both analysis and preparation status are visible in Plain Text as well as Speakers.

## Release checks

Run `npm run typecheck`, `npm run lint`, `npm run test -- --run`, `npm run test:storybook -- --run` and `npm run build`. Verify prepared components with `python scripts/verify-speaker-release.py --all build-assets/release-components`, then run `python scripts/smoke-nemotron.py <variant>` on each target OS. Measure paired Windows installers with `npm run measure:speaker:installer -- win-x64-gpu` or `win-x64-cpu` from a stable checkout.

Completed locally: typecheck, lint, build, 243 unit tests (30 files), 16 Storybook tests (2 files), component archive verification and the paired installer measurement above. The owned Storybook server and packaged test application were stopped after verification.

Before opening the PR, typecheck, lint, build, all 243 unit tests and 17 Storybook tests passed again on top of main `4fcee586` (including the newer narrow-pane UI scenario). The native implementation and component payload are unchanged from the measured integration build; installer and GPU timings above refer to that integration build.

Fresh OS installation, driver diversity, physical Metal GPU performance and signed/distributed release downloads require release-environment checks. Release publication is not part of the local implementation task.
