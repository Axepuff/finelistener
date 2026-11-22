# Persisted Summary progress

`SessionTranscriptV1.summary` remains the readable result (including historical
brief-only retry caches). `summaryDraft` is an independent, optional replacement
in progress. A draft contains accepted reviewed chunks, their exact detailed join,
model, options, generation version, normalized `inputHash`, exact `sourceRevision`
and `progress`. It has no brief or generated date. It never replaces a completed
brief/detailed pair. Successful completion atomically publishes the new pair with
`generatedAt` and removes the draft in the same transcript-file rename.

## Cursor version 1

`progress.version = 1` describes source positioning, independently of generation
version 4 (unchanged prompts/model strategy). `progress.cursors` has one entry per
accepted chunk, in order. Each entry contains:

- `groupIndex`: index in the deterministic source groups produced by the saved
  `chunkCount` option; automatic mode uses one group.
- `startChar`, `endChar`: half-open UTF-16 offsets in concatenated normalized
  speech text within that group, excluding timing/speaker prefixes and separators.

These are different coordinates from `sourceRefs`, which still address original,
unnormalized segment text in the exact source revision. The cursor supports a
position inside a long utterance, including Unicode and collapsed whitespace.
Coverage must start at zero, be contiguous without gaps or repetitions, and move
to the next group only after finishing the current group. Source refs, speaker
snapshots and times must match the reconstructed accepted passage.

`phase = chunks` means unread speech remains. `phase = brief` means the final
cursor reaches the end of the final group; all reviewed chunks are available for
brief synthesis. Every accepted chunk is atomically persisted before the next
inference call, including the final chunk's transition to `brief`. Stop/error
retains the last committed checkpoint. Interrupted native calls and interrupted
uncommitted file writes can be repeated; accepted persisted chunks are not.

Continue reconstructs the last accepted passage from its cursor for the existing
overlap calculation, slices the unread suffix and resumes normal packing. It
does not tokenize or infer accepted passages again. Failed smaller-budget attempts
cannot leave speculative splits in the source for later accepted passages.
Detailed remains `reviewedChunks.map(chunk => chunk.text).join('\n\n')` with no
extra model rewrite. The 3,100-token automatic target, 10% default overlap, user
prompt, language checks and bounded brief synthesis remain in use.

## Compatibility and ownership

Reading a draft checks both hashes, cursor version/coverage/phase, generation
version, detailed join and source metadata without loading the model. Generating
also requires the same model and exact prompt/chunkCount/overlap options. An
incompatible draft is ignored and a fresh generation can replace it; malformed
progress passed directly to the generator returns `draft-incompatible`.

The normalized legacy hash has not changed. Legacy completed results remain
readable offline with their actual date/metadata (or their absence). A legacy
brief retry without an exact revision can still reuse its reviewed chunks; no
source refs or exact revision are invented. An exact-revision cache whose source
changed cannot become a legacy retry just because the readable view strips its
now-invalid refs. Brief failure leaves accepted notes available for retry.

Transcript writes are serialized and validate input revisions. Summary writes
also capture active-session generation and recheck ownership before the atomic
rename, alongside cancellation. A stop after a completed rename returns that
committed success. A committed draft is published separately even when Stop
arrives during its rename. Renderer delivery checks operation ownership, session
and transcript identity; a draft event cannot publish a partial completed result.

## Integration hooks

Session reads expose `transcript.summaryDraft`; `sessions:summary-progress`
exposes `draft` separately from the legacy `saved` field. `SummaryStore.generate`
accepts an optional fourth `onDraft` callback, wired through AppStore to the saved
transcript's separate draft field. Calling the existing generate command with
the same options continues compatible progress, including after reopening the
session/application. This PR supplies the persistence and lifecycle contract;
the Continue button and redesigned states belong to #33/#34.
