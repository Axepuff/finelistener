import type { WhisperModelName } from './whisper';

export type Segment = { start: number; end: number };

export interface TranscribeOpts {
    language: string;
    model?: WhisperModelName;
    maxContext?: number;
    maxLen?: number;
    splitOnWord?: boolean;
    useVad?: boolean;
    useGpu?: boolean;
    vadModelPath?: string;
    segment?: Segment;
}
