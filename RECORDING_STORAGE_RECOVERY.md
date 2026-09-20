# Recording Storage, Recovery, and Path Ownership

Status: proposed.

This plan complements [ADR 0002](docs/adr/0002-preserve-recording-sources-for-transcription.md). Separate source tracks remain the canonical recording data, but their ownership, finalization, recovery, and cleanup move entirely into the main process.

## Problem

The current recording workflow sends a `RecordingResult`, including absolute track paths, from the main process to the renderer and then back through `sessions:import-recording`.

The IPC controller accepts an object containing `filePath`, and `SessionsService` validates each track path only as a non-empty string. After copying and mixing the tracks, it removes the submitted source paths. A compromised or defective renderer can therefore submit a readable audio path outside FineListener's recording directory. If session creation succeeds, the original file is removed from its previous location. Its contents normally survive inside the new session, but the renderer has still caused an unauthorized filesystem mutation.

This is a low-likelihood, high-impact condition rather than a normal user workflow. It requires control of the renderer payload, for example through renderer code injection, an XSS defect, DevTools, or a future caller bug. The current application normally sends paths originally created by `RecordingService`.

The storage lifecycle has a related problem:

- successful session creation removes temporary capture files;
- failed import or mixing deliberately leaves the capture files intact to avoid destroying the last copy;
- there is no recovery index or automatic management for those remaining files;
- source tracks, the listening mix, and optional optimized audio are all persisted even though only the source tracks are irreplaceable.

Consequently, failed recordings can become undiscoverable orphan files, while derived files can consume avoidable disk space.

## Current Mitigation

The native helper now marks the specific error raised after all encoders have been closed as recoverable. `MiniAudioAdapter` converts that post-ready error into a partial `RecordingResult`, marks the tracks as potentially incomplete, and lets the existing session import path run. Startup errors and unexpected process termination remain fatal.

This prevents the known finalization error from permanently locking the renderer operation and gives finalized tracks a chance to be imported. It does not remove absolute paths from IPC, index failed imports, validate every recovered track, or provide a storage-retention policy.

## Goals

- Never accept a filesystem path from the renderer for capture finalization, recovery, or deletion.
- Never delete the only known valid copy of captured audio as part of an automatic cleanup step.
- Publish a session only after its canonical tracks and metadata are durable.
- Preserve every individually valid source track when another track is invalid or incomplete.
- Make interrupted recordings visible and recoverable after an application restart.
- Bound automatically rebuildable storage without deleting canonical source tracks.
- Keep legacy single-file and imported sessions working.

## Non-goals

- Cloud backup or cross-device synchronization.
- Keeping an unlimited recording history without user-managed storage.
- Adding microphone support to platforms not already covered by the recording feature.
- Changing the source-labelled transcription model established by ADR 0002.

## Proposed Ownership Model

The main process owns the complete lifecycle. The renderer receives opaque identifiers and user-safe metadata, never capture paths.

```text
capturing
    |
    v
pending/<recordingId> ---- failure or crash ----> recoverable
    |
    | validate tracks, create metadata and listening mix
    v
sessions/.staging/<sessionId>
    |
    | atomic directory rename
    v
sessions/<sessionId> ---- derived files evicted ----> regenerate on demand
```

Introduce a deep `RecordingArchive` module in the main process. It hides path resolution, manifests, validation, atomic publication, recovery, and cleanup behind a small interface:

```ts
interface RecordingArchive {
    finalize(recordingId: string): Promise<FinalizeRecordingResult>;
    listRecoverable(): Promise<RecoverableRecording[]>;
    recover(recordingId: string): Promise<FinalizeRecordingResult>;
    discard(recordingId: string): Promise<void>;
}
```

`RecordingService` and the capture adapter use internal paths supplied by this module. `SessionsService` consumes a finalized main-process recording reference rather than a renderer-supplied `RecordingResult`.

The renderer-facing recording methods return values such as `recordingId`, `sessionId`, completion status, source warnings, duration, and size. They do not return or accept absolute paths.

## Pending Recording Layout

Each capture starts in a directory controlled by the main process:

```text
userData/
  recordings/
    pending/
      <recordingId>/
        recovery.json
        audio/
          system.wav
          microphone.wav
```

`recovery.json` is written atomically through a temporary file and rename. It records:

- recording ID and creation time;
- lifecycle state: `capturing`, `ready`, `recoverable`, or `committing`;
- enabled sources and expected filenames;
- observed duration, size, and source failures;
- enough non-sensitive metadata to present a recovery choice after restart.

No manifest stores an arbitrary path. Track filenames are fixed by source kind and resolved relative to the recording directory.

## Transactional Session Commit

Finalization follows these steps:

1. Stop the helper and close all encoders.
2. Validate every expected track independently. At minimum, require a regular file, a valid PCM WAV structure, and a readable duration. FFmpeg preparation may provide the definitive validation already used by the application.
3. Retain every valid track even if another track fails validation. Record a source warning for incomplete or rejected tracks.
4. Build the listening mix from only the valid tracks. A single valid track is a valid partial session.
5. Write the complete session manifest atomically.
6. Rename the prepared directory into `sessions/<sessionId>` on the same filesystem. The final directory becomes visible only after this rename succeeds.
7. Return the published `sessionId` and source warnings to the renderer.

If any step before publication fails, keep the valid capture files and mark the recording `recoverable`. Do not leave a partially published session and do not require the renderer to retain operation ownership indefinitely.

The pending directory should already use the final session-compatible layout where practical. This allows publication by rename instead of copy-then-unlink and avoids keeping two copies of the canonical tracks during normal finalization.

## Path Safety

Opaque IDs are the primary protection. Filesystem operations must also apply defense in depth:

- accept recording and session IDs only in the established safe ID format;
- construct paths from known roots and fixed relative filenames;
- resolve canonical paths before destructive operations and verify containment with `path.relative`;
- reject symlinks, junctions, and other reparse-point escapes for pending track files;
- delete only a directory or file whose ownership is recorded in a main-process manifest;
- never cast an IPC payload to a capture result without runtime validation.

## Storage Policy

Canonical and derived data have different retention rules.

### Canonical data

- Source tracks are the canonical recording and remain until the user deletes the session.
- A valid recoverable recording is also canonical because it may be the only copy. Do not silently delete it.
- Show recoverable recordings in the UI with their age, size, source status, and `Recover` and `Delete` actions.
- Use a configurable soft retention period, recommended default 14 days, to increase warning prominence rather than silently deleting data.
- Use a configurable recovery quota, recommended default 2 GiB. When it is exceeded, require the user to recover or discard old recordings before starting another capture instead of silently deleting the only copy.
- Empty files and files proven to contain no recoverable audio may be removed automatically after a short grace period.

### Derived data

- The listening mix is rebuildable from source tracks and should be treated as a cache.
- Optimized audio is also rebuildable and should use the same cache policy.
- Evict derived files automatically using a size budget and least-recently-used order. A recommended initial budget is 1 GiB.
- Regenerate a missing listening mix or optimized file on demand through `SessionsService`.
- Deleting a session removes its canonical tracks, transcript, metadata, and any derived cache files together.

At 16 kHz mono 16-bit PCM, one track uses approximately 110 MiB per hour. A two-source recording therefore needs about 220 MiB per hour of canonical storage. The current persistent listening mix adds about 110 MiB per hour, and optimized audio can add another 110 MiB per hour. Making both derived files evictable can reduce steady-state storage from roughly 440 MiB to 220 MiB per recorded hour.

## Startup Recovery

At startup, the main process scans only the pending recording root and reads valid recovery manifests.

- `capturing` entries from a previous process become `recoverable` after track validation.
- `committing` entries are either completed idempotently or returned to `recoverable` state.
- Directories without a valid manifest are quarantined and shown as unknown recovery data rather than deleted immediately.
- Recovery actions are idempotent so an application crash during recovery can be retried safely.

The renderer displays a concise notification when recovery items exist. Technical validation details remain in developer logs.

## Incremental Implementation

1. Add strict canonical-path containment checks to the existing import path as an immediate safeguard.
2. Add `recordingId` and a main-process pending-recording registry. Stop exposing track paths through preload and renderer types.
3. Introduce the recovery manifest and move capture output to per-recording pending directories.
4. Move session finalization orchestration behind `RecordingArchive.finalize` and publish sessions atomically.
5. Validate tracks independently and allow a session containing surviving sources.
6. Add recovery list, recover, and discard IPC methods using IDs only.
7. Add the recovery UI and recording-quota warning.
8. Mark listening and optimized audio as evictable, add cache accounting, and regenerate missing derived files on demand.
9. Remove the legacy renderer-to-main `RecordingResult` import path after migration tests pass.

## Validation

- A crafted renderer payload cannot cause main-process filesystem access outside the pending recording and session roots.
- Symlinks or junctions inside the pending root cannot escape path containment.
- Successful finalization leaves one canonical copy of every valid source track and no pending duplicate.
- A failed source does not discard another valid source.
- A crash at every commit step leaves either a published session or a discoverable recovery entry, never an invisible orphan.
- Recovery remains possible after application restart and is idempotent across repeated attempts.
- Reaching the recovery quota blocks new capture with a user-safe explanation and does not silently delete recordings.
- Cache eviction removes only derived files; reopening the session regenerates them and preserves playback and transcription behavior.
- Legacy sessions and imported files continue to open, play, optimize, transcribe, and delete correctly.
- Typecheck, lint, automated tests, Electron build, native helper build, and native timeline tests pass.

## Recommended Decision

Adopt main-process ownership with opaque recording IDs and transactional directory publication. Keep source tracks as canonical data, expose failed captures through an explicit recovery workflow, and treat listening and optimized files as bounded caches. This removes renderer-controlled deletion, minimizes duplicate storage, and avoids trading disk cleanup for silent loss of the user's only recording copy.
