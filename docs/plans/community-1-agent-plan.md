# Community-1, selected audio and readable speaker turns

Canonical tracker: https://github.com/Axepuff/finelistener/issues/14.

Agreed with the user on 2026-10-04. Implementation plan; application changes have not been made as part of this planning task. Follow-up to https://github.com/Axepuff/finelistener/issues/13. This issue replaces its sherpa-specific runtime, audio selection, default opt-in and text-presentation requirements; retain its session identity, recording-source, correction, cancellation and backward-compatibility invariants unless explicitly changed below.

## Outcome and accepted behavior

### Audio and Transcribe

- New sessions use **Optimized** by default for playback, recognition and speaker analysis. Generate the derived audio when needed, once per source/configuration, and reuse it. Preserve original audio.
- Remember Original/Optimized **per session**. Reopening retains an explicit choice; legacy sessions without a stored choice use Optimized. The selector changes subsequent processing, not an already saved transcript or speaker result.
- Original processing uses preserved original audio with only the format conversion required by the worker. Do not accidentally substitute a previously normalized listening cache or apply Optimized twice. Imported and recorded sources must follow the same choice.
- Keep recorded microphone/system audio separate. Optimize an individual system track for its analysis, not the listening mix containing microphone audio. Preserve track offsets and selected-range boundaries; never remove silence or shift the timeline.
- Speaker analysis is enabled by default after **Transcribe**, with a remembered opt-out. Preserve existing saved false preferences; change defaults where the preference is absent, in both main and renderer. Count defaults to Auto, with an optional exact positive count.
- Save successful recognition before speaker analysis. Show separate recognition and speaker-analysis phases. A speaker error/cancellation leaves saved text intact and provides a standalone retry that does not rerun ASR. Preserve the existing incomplete-source retry workflow.
- Microphone-only recordings have one assumed microphone speaker and need no model invocation/download. Exact counts refer only to system/imported speakers, excluding the microphone identity.
- Snapshot session, audio choice, range, count, and recognition revision for an operation. UI changes, session replacement, late output and cancelled downloads must not change the meaning of a running job or publish stale results.

### Community-1 and assignments

- Replace sherpa with the **full local pyannote Community-1 pipeline**, retaining Whisper for recognition. Use standard Community-1 parameters; sherpa thresholds 0.95/1.25 do not transfer.
- Use **exclusive diarization** for assigning one speaker to transcript text. Preserve regular overlapping diarization separately as acoustic evidence. Exclusive output is a text-alignment policy, not proof that overlapping speech did not occur.
- Preserve the current conservative treatment of missing word timing, ties and unassignable text. Do not duplicate or invent transcript words to represent overlaps. Keep the fixed microphone identity independent of system identities.
- Retain raw recognition, stable segment IDs/character spans, word timing, reversible duplicate filtering, manual corrections, renames and merges. Identities remain session/generation scoped.
- Store optional versioned provenance: engine/model/runtime revision, selected audio variant, range/count and regular/exclusive interval representations. Existing sherpa/v1 sessions remain readable; changing engine or opening a session never silently reanalyzes it.
- A confirmed successful rerun can replace speaker identities and corrections. Failed/cancelled reruns retain prior results. Existing confirmation behavior for replacing annotations remains.

### Plain Text, Timecodes, search and export

- **Plain Text** contains speech text only: no timestamps, speaker labels, recording-source prefixes or inline speaker-edit controls. Copy and TXT export contain the same text.
- **Timecodes** shows speaker turns. Combine adjacent visible fragments only when they have the same known speaker identity and recording source and the silent gap is at most **5 seconds**. A different speaker/source, an unresolved assignment, or a longer pause breaks the turn. Do not group by display name or merge all occurrences of one speaker across intervening speech.
- Grouping is a derived presentation, not a rewrite of recognition. Retain all constituent raw spans, IDs, text boundaries and timestamps. Use the first start time as the displayed/seek timestamp and retain the full member timing range. Keep original chronological ordering and text/punctuation; insert only necessary joining whitespace.
- Unknown spans do not establish that two fragments are the same speaker. Without diarization, preserve individual timecoded fragments and existing source context; clean Plain Text still omits prefixes.
- A grouped-turn speaker edit applies to **all member spans atomically**. Provide expansion to edit an individual original fragment. Validate every member against session/recognition/generation before committing any change. Regroup after edits/merges/filter changes.
- Display, search highlighting/navigation, timestamp seeking, plain/HTML clipboard and TXT export must consume consistent mode-specific projections. Search offsets in joined text must map to constituent spans without corrupting raw character offsets.
- Retain current tab-selection behavior. No automatic switch to Timecodes was requested. All new UI strings, logs and code comments are English.

## Runtime and distribution constraints

Use a bounded worker process owned by Electron main; renderer communicates through typed preload/RendererAdapter contracts. No system Python requirement, developer PATH reliance, cloud inference, user audio upload or generic plugin framework. A packaged private Python runtime is acceptable; a copied development venv is not a release artifact.

Preserve the actual shipping matrix: Windows x64 CPU, Windows x64 GPU (CUDA with CPU fallback), macOS arm64 CPU diarization. Whisper Vulkan/Metal is separate. Do not promise Vulkan diarization or invent Linux/Windows arm64 release support. Keep runtime libraries isolated from Whisper.

Retain the prior **200,000,000-byte additional compressed installer payload** rule: measure the cumulative addition against an otherwise identical build, report installed footprint separately, and deliver oversized components as versioned downloads associated with the application release. Pin manifests, hashes, sizes and licenses; support progress, cancellation, validated extraction, atomic activation, repair and offline reuse. Model access/redistribution terms and notices must be checked for the exact shipped artifacts. Do not ship personal Hugging Face credentials or require account login during inference; if distribution cannot meet these conditions, report that packaging blocker before shipping an alternative.

Default speaker processing may need a first-use component download. Present its size/status and allow cancellation; ASR and saved text remain usable if assets are unavailable. Do not silently change audio mode or silently present CPU as CUDA. Fall back once on supported CUDA initialization failures, never on cancellation. Kill and await worker termination before releasing the foreground operation.

## Evidence and implementation traps

The accepted local experiment ran two ten-minute recordings through Community-1, Original/Optimized and auto/exact counts (eight runs). Auto returned 3 and 2 speakers respectively; each auto result matched its corresponding exact-count intervals. The user accepted listening quality. Inference was about 23 seconds per run on GTX 1070. This is limited evidence, not an accuracy or speed guarantee for arbitrary recordings.

Local reproduction: `.artifact-work/pyannote-test-20261004/run.py`, `requirements-lock.txt`, `summary.json`. Private audio and these machine-local paths are not CI fixtures. Use synthetic fixtures for automated tests; keep private recordings uncommitted.

Working experiment: Python 3.12, pyannote.audio 4.0.0, torch/torchaudio 2.8.0+cu126, TorchCodec 0.7.0, CUDA batches of 4. Newer TorchCodec 0.17 hung on import with this Torch. The experiment loads decoded waveforms using SoundFile; native TorchCodec decoding remains unavailable. Production should deliberately reuse a predecoded-waveform boundary or validate a complete decoder stack, rather than rely on the warning being harmless for all code paths. Safe loading explicitly allows only pyannote's Problem, Resolution and Specifications types; do not disable checkpoint safety globally. CUDA torch's downloaded wheel alone was about 2.9 GB, so runtime packaging is a first-class deliverable.

Main seams:
- `SessionSpeakerWorkflow`, `SpeakerDiarizationService`, `SessionsService`, `AudioPreprocessor`, and the per-source transcription runner.
- `AppStore`, `WorkspaceStore`, `SpeakerAnalysisStore`, `uiPreferences`, typed preload and RendererAdapter.
- `transcriptFormat`, `TranscriptionStore`, `TranscribedTextContent`, speaker controls/search and export.
- `SessionRawSpan` currently points to exactly one raw segment. A combined row needs multiple retained members, not a fabricated cross-segment span; group assignment needs a minimal typed atomic operation.
- Current standalone diarization selects imported original/system raw paths regardless of the UI mode. Fix both automatic and standalone calls.
- Current Plain Text and Timecodes share per-segment prefix formatting. Changing JSX alone will leave search/copy/export inconsistent.
- Existing uncommitted work includes Whisper timestamp repair, speaker progress and bounded CUDA probing. Inspect and preserve it; do not treat the dirty tree as disposable.

## Agent work packages

A single implementation agent can execute A–F in order. If work is delegated, one coordinator owns shared types, preload, persistence and integration. B and C may proceed after A freezes their contracts; E may proceed against the agreed projections. D integrates B/C before final acceptance.

| Package | Deliverable | Completion gate |
| --- | --- | --- |
| **A — Contracts and migration** | Freeze worker protocol, audio-choice/provenance fields, interval representations, grouped view model and atomic multi-span assignment. Record ADR/glossary; map legacy preferences and sessions. | Synthetic old/new session fixtures load without rewriting history; precise contract examples cover auto/exact, exclusive/regular and grouped edits. |
| **B — Community-1 runtime and assets** | Build pinned private runtime/model packages, waveform boundary, CPU/CUDA detection, process cancellation, progress, manifests/notices and release preparation. Report packaging feasibility early. | Real short CPU/CUDA inference, offline restart, interrupted install/repair, path-with-spaces/Unicode and clean-machine resource resolution pass; each unsupported hardware check is an explicit release gate. |
| **C — Selected audio lifecycle** | Persist session mode; prepare/cache Optimized; propagate the selected source to all recognition/analysis routes; preserve per-track offsets and original audio. | New/legacy/reopened sessions, Original override, optimization failure, cancellation and source-aware recording tests pass without duplicate filtering/normalization or stale mutations. |
| **D — Analysis workflow and assignment** | Integrate full pipeline after saved ASR and standalone retry; use exclusive intervals for projection while retaining regular output; preserve edits and stale-result guards. | Both reference recordings work through application boundaries; microphone-only makes zero inference calls; partial ASR, rerun failure, cancellation and session changes retain valid saved results. |
| **E — Presentation and edits** | Implement clean Plain Text and grouped Timecodes, child expansion, atomic group assignment, consistent search/seek/copy/export. | Same-speaker joins and all break conditions pass; batch edit either changes all valid members or none; no lost/duplicated text or invalid raw-span references; manual UI walkthrough succeeds. |
| **F — Release and quality acceptance** | Integrate packages, remove obsolete sherpa-only runtime/assets from new builds while retaining old-session readers, update documentation and verify packaged artifacts. | Required repository checks and per-platform release gates are recorded; no silent CPU-only or single-platform substitution; listener verifies real transcript alignment, not just interval counts. |

## Required acceptance cases

- Exactly 5-second gap joins; longer gap separates. Speaker A/B/A, unknown spans, distinct sources, two speakers with the same name, rename/merge and duplicate-filter toggles produce correct groups.
- Group edit validates every constituent span and rejects stale generations without partial mutation; expanded child edits regroup correctly.
- Clean text/search/export preserve Unicode, punctuation, subword joins and empty/legacy transcripts. Timecode click seeks to the displayed turn start. Copy as text/HTML and TXT match selected view.
- New and existing sessions without a mode start Optimized; explicit Original survives reopen. Switching mode does not relabel old text. No additional normalization on cached Optimized. Selected-range and per-track offsets remain exact.
- Diarization defaults on only when no saved preference exists; saved opt-out survives upgrades. No speech/empty transcript does not fabricate speakers.
- Missing models, denied download, failed conversion, unavailable CUDA, worker crashes, stop/restart, late IPC and incomplete source recognition leave valid text/results intact.
- Private reference listening checks cover both recordings and audio variants in the real UI; auto and exact counts, short interruptions and overlap are checked separately from text recognition accuracy.
- Run `npm run typecheck`, `npm run lint`, `npm run test -- --run`, and `npm run build`. Hardware/package checks unavailable on the development host remain documented release blockers, not fabricated passes.

## Handoff

Implement this issue in the existing architecture, preserving user work. Begin with A and an early B feasibility report. Deliver a reviewable PR with behavior changes, runtime/model provenance, test results and outstanding platform gates. Do not consider the task complete after a CLI prototype, a UI-only grouping change, or a development-machine-only Python integration.
