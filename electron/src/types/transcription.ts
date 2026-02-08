import type { WhisperModelName } from './whisper';

export type Segment = { start: number; end: number };

export interface TranscribeOpts {
    language: string;
    model?: WhisperModelName;
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
