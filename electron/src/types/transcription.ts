import type { WhisperModelName } from './whisper';

export type Segment = { start: number; end: number };

export interface TranscribeOpts {
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
}
