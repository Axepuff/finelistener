---
status: accepted
---

# Add session-scoped speaker diarization

The runtime, default audio/analysis selection, and transcript presentation decisions below are superseded by [ADR 0006](0006-use-community-1-and-speaker-turn-views.md). Other session and recording-source invariants remain applicable.

Add offline speaker diarization with sherpa-onnx for recorded system audio and imported session audio, retaining whisper.cpp for recognition. Treat a recorded microphone track as one assumed speaker and never run sherpa on it, including microphone-only recordings. This is a product assumption, not evidence that microphone audio contains no echo. Users can request speaker labels during transcription or add them to an existing transcript without repeating speech recognition solely for diarization. Speaker identities and names belong to one session, independently of recording sources; recognizing a person across sessions is outside this feature.

Preserve separate recording sources and reversible duplicate filtering from ADR 0002 and ADR 0004. Use a native sherpa CLI child process controlled by main. Follow existing application build variants: Windows CPU uses CPU; Windows GPU uses CUDA when available and CPU otherwise; macOS arm64 uses CPU diarization alongside Metal recognition. sherpa-onnx does not support Vulkan. Bundle components up to the user's 200 MB added-package threshold; provide larger components as a versioned download.

Allow users to rename speakers, reassign transcript utterances, and merge speakers. Determine the system/imported speaker count automatically unless the user supplies an exact count, excluding the fixed microphone speaker. Do not match microphone and system identities automatically. Keep recognition segments and stable character spans as the baseline for filtering, speaker labels, and corrections. A successful new diarization replaces previous speaker labels and corrections after a warning; failed or cancelled replacement preserves the previous result. A new recognition revision invalidates its previous speaker metadata.

[The implementation specification](https://github.com/Axepuff/finelistener/issues/13) records the agent work packages and verification gates.
