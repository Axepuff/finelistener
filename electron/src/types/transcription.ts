import type { WhisperModelName } from './whisper';
import type { RecordingSource } from './sessions';

export type Segment = { start: number; end: number };

export interface TranscribeOpts {
    runId: number;
    language: string;
    model?: WhisperModelName;
    /**
     * Optional persisted session id. If provided, the app will store the resulting transcript into the session folder.
     */
    sessionId?: string;
    /**
     * Absolute path to a custom whisper.cpp model file copied into the app user models directory.
     * If provided, takes precedence over `model`.
     */
    modelPath?: string;
    maxContext?: number;
    maxLen?: number;
    splitOnWord?: boolean;
    useVad?: boolean;
    useGpu?: boolean;
    vadModelPath?: string;
    segment?: Segment;
    optimized?: boolean;
}

export interface TranscriptionTextEvent {
    runId: number;
    chunk: string;
    source?: RecordingSource;
    offsetSec?: number;
}

export interface TranscriptionProgressEvent {
    runId: number;
    value: number;
    source?: RecordingSource;
}

export interface SessionTranscribeOpts extends TranscribeOpts {
    retryFailed?: boolean;
    optimized?: boolean;
    hideDuplicateSpeech?: boolean;
}
