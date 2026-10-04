# Diarization timestamp regression and audio comparison

## Reproduced failure

The bundled whisper.cpp restores VAD segment timestamps to the original audio
timeline, but its public token-data accessors return timestamps on the shortened
VAD timeline. A native 30-second recording reproduced a segment starting at 2.27s
with its first token at 0.03s. FineListener correctly rejects these inconsistent
word timings. Reusing the server with VAD disabled also retained the previous
request's VAD mapping.

`scripts/patch-whisper-timestamps.cjs`, invoked by `scripts/build-whisper.sh`,
maps nonnegative token start/end times through the existing native VAD mapping
without changing stored decoder tokens. It clears the mapping at the start of
each inference. Negative sentinel values remain unchanged. The patch is
idempotent and fails on an unrecognized source layout instead of silently
producing an unpatched build. Revisit it when updating whisper.cpp. DTW is not
enabled by FineListener; this patch does not change `t_dtw`.

Rebuild native assets; `npm run build` alone does not rebuild whisper.cpp.
Against a dedicated server and a speech WAV containing leading silence and pauses:

```sh
node scripts/check-whisper-timestamps.cjs http://127.0.0.1:17997 sample.wav
```

The check fails on the unpatched binary and passes on the patched CPU binary
while switching VAD on, off, and on again. Zero-duration tokens are not evidence
of accurate word alignment and are excluded from this check.

## Local experiment, 2026-09-30

No private audio or transcript is included in this document or test fixtures.
The source session was not modified. Comparison artifacts are local ignored
files under `build-assets/diarization-diagnostic`.

- The saved 107-minute transcript had 1,843 segments: 1,842 without word timing
  and one partially timed. Its 319 unknown labels comprised 317 segments
  intersecting multiple speaker identities and two intersecting no speech.
- Patched large-v3-turbo-q8_0, first 180 seconds of the original file: 43/44
  segments retained some word timing, 37/44 retained all words. With highpass
  80 Hz, lowpass 12 kHz and dynaudnorm f=150:g=15:p=0.95: 48/49 and 43/49.
  These are timing-coverage measurements, not transcription accuracy scores.
- ERes2Net with exactly two speakers on the original 180-second clip assigned
  approximately 60/48 seconds. On the existing listening WAV: 62/48 seconds.
  Applying optimized filters again to that listening WAV produced 14/98 seconds.
  Cluster numbering is arbitrary; balance alone does not establish correctness.
- TitaNet small on the listening clip produced approximately 98/14 seconds.
  This did not justify switching the default embedding model.

Imported speaker analysis now uses the original file, since the listening WAV
may already have dynamic normalization applied. It is converted to mono/16 kHz
without speech filters. Existing recognition cannot recover discarded word
timings: it requires a new ASR run using rebuilt native assets. Audio optimization
defaults for ASR were not changed by this fix.

## Remaining quality checks

Long-recording clustering and perceived transcript accuracy remain unverified.
Compare hand-labelled turns at the beginning, middle, and end before changing
models or introducing windowed clustering. Do not treat fewer unknown labels as
proof of better speaker assignment. Windows CPU and GPU native builds passed;
macOS native execution was not available on this host.
