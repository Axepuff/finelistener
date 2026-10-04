---
status: accepted
---

# Use Community-1 and speaker-turn transcript views

Replace ADR 0005's sherpa-specific engine choice with the full local pyannote Community-1 pipeline. Tuning sherpa's clustering threshold did not generalize across two recordings, whereas Community-1's default automatic results matched supplied-count results on both and passed the user's listening review. This evidence supports the choice without establishing universal accuracy. Preserve ADR 0005's session identities, source separation, corrections, atomic replacement and cancellation invariants.

Use Optimized by default for listening, recognition and speaker analysis; retain an explicit Original choice per session. Enable post-recognition diarization by default when no saved preference exists, preserving opt-out and saved text on analysis failure. Use exclusive diarization for text assignment and retain overlapping acoustic output separately.

Plain Text is speech text without timecodes, speakers or source labels. Timecodes groups adjacent known same-speaker, same-source fragments into turns across pauses of at most five seconds. Keep underlying spans intact for atomic whole-turn assignments and expanded child edits. Copy and export follow the selected view.

The complete pipeline requires a managed private runtime rather than a replacement sherpa ONNX embedding model. Preserve existing platform targets and the measured 200 MB compressed-payload limit, using versioned downloads for larger components. The [implementation plan](../plans/community-1-agent-plan.md) is published as [issue #14](https://github.com/Axepuff/finelistener/issues/14). These decisions authorize the plan, not an assertion that integration is already complete.
