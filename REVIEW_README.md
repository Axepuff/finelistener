# Microphone recording: review handoff

Review the working-tree changes against `b025aa3`, including untracked source and test files. Earlier commits `9d81097` (renderer refactor) and `b025aa3` (Oxlint autofixes) are the baseline. Read `AGENTS.md` for repository rules.

## Intended behavior

- Record selected system audio and microphone simultaneously; each source can be disabled. Persist device choices.
- Preserve separate original tracks on a shared timeline and create a mixed file for playback.
- Transcribe tracks sequentially, merge timestamped results, and retain system/microphone labels. These labels identify recording sources, not individual speakers.
- Save completed sources when another fails. Retry only unfinished sources using the original transcription settings and selection.
- Keep imported files and older sessions working.
- Allow any selected capture device. Echo cancellation and speaker/headphone-specific behavior are outside the agreed scope.

## Review priorities

1. **Capture and persistence:** timing, resampling, mix clipping, graceful stop, device disconnects, cleanup, and recovery of surviving tracks. Start with `miniaudio-loopback/src/`, `MiniAudioAdapter.ts`, `RecordingService.ts`, and `SessionsService.ts`.
2. **Transcription:** selection offsets, merging, retry persistence, cancellation, and stale callbacks. Start with `SessionTranscriptionRunner.ts`, `TranscriptionService.ts`, and renderer transcription/workspace stores. Check typed IPC and preload contracts along their callers.
3. **Silence regression:** native Whisper can crash or hang after VAD reports zero speech segments (`unknown language id -2`). Digital-zero PCM now bypasses inference; an explicit request-scoped zero-VAD result aborts inference, closes the server, and completes that source with empty text. The next source must remain transcribable. Inspect `Whisper.ts` and `pcmSilence.ts`, especially cancellation precedence and isolation between requests.
4. **UI outcomes:** distinguish all-source failure from partial completion. A successfully processed source with no speech counts as completed. Logs must reflect the actual outcome.

## Validation already performed

- 95 tests passed; typecheck, lint, and production build passed.
- Native timeline tests passed during feature implementation.
- A direct request to the real Whisper binary reproduced the pre-fix no-speech hang. Post-fix automated tests cover the recovery path; the additional real-binary smoke test was interrupted by an agent usage limit.
- The user reports the application works. The reported playback issue was external to the application. Physical device hotplug coverage remains limited.

Report actionable defects with severity, file/line, triggering scenario, and impact. Separate confirmed defects from validation gaps. Review without modifying files; prioritize correctness and data preservation over unrelated style changes.
