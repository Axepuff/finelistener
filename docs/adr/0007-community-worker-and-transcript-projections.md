---
status: accepted
---

# Community worker and transcript projections

Issue #14 extends ADR 0006. Retain transcript/session version 1; optional provenance version 1 records engine, immutable model/runtime revisions, audio mode, range/count, backend, and both interval representations. Existing intervals remain the assignment input; new analyses populate them from exclusive output. Legacy sessions without provenance remain readable and are never reanalyzed on open.

The worker receives one JSON request file (protocol 1, predecoded mono 16 kHz WAV, local model directory, cpu/cuda, optional positive count). It emits bounded progress on stderr and one JSON result on stdout with regular/exclusive intervals sharing the same label namespace. CPU fallback is allowed once for explicit CUDA initialization failure, never for cancellation or general inference errors. Main awaits process close before ending an operation.

Audio mode defaults to optimized only when absent. Operations snapshot it and recognition revision; incomplete recognition retains its source-run mode. Originals undergo only format conversion. Derived track caches are keyed by source fingerprint and optimization configuration, and never replace preserved tracks.

Timecoded rows retain multiple members with raw spans and joined-text offsets. Only adjacent known same identity/source fragments across gaps <= 5 seconds group. Plain projection joins speech only. Assigning a row sends {recognitionRevision, generation, spans}; all spans validate before one persisted correction transaction. For example auto omits speakerCount, exact uses speakerCount: 3; regular overlapping intervals remain provenance while exclusive intervals drive text assignments.
