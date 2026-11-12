import type { WhisperModelName } from './whisper';
import type { RecordingSource, SpeakerEngine } from './sessions';

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
    microphoneGateEnabled?: boolean;
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
    labelSpeakers?: boolean;
    speakerCount?: number;
}

export interface AnalyzeSpeakersOptions {
    audioMode?: 'original' | 'optimized';
    recognitionRevision?: string;
    range?: Segment;
    speakerCount?: number;
}

export interface SpeakerAnalysisProgressEvent {
    sessionId: string;
    percent?: number;
    phase: 'preparing' | 'downloading' | 'converting' | 'analyzing' | 'saving' | 'fallback';
    downloadedBytes?: number;
    totalBytes?: number;
}

export interface SpeakerAssetStatus {
    engine?: SpeakerEngine;
    ready?: boolean;
    vulkanAvailable?: boolean;
    downloadBytes?: number;
    runtimeRevision?: string;
    cpuReady: boolean;
    cudaReady: boolean;
    cudaAvailable: boolean;
}

export const SPEAKER_ERROR_MESSAGES = {
    SPEAKER_ASSETS_UNAVAILABLE: 'Speaker components are unavailable. Prepare or repair the component and try again.',
    SPEAKER_GPU_UNAVAILABLE: 'GPU speaker analysis is unavailable. Update your graphics driver and try again.',
    SPEAKER_GPU_FAILED: 'GPU speaker analysis could not finish. Check your graphics driver and try again.',
    SPEAKER_COUNT_UNSUPPORTED: 'Nemotron counts speakers automatically. Clear the exact speaker count and try again.',
} as const;

export type SpeakerErrorCode = keyof typeof SPEAKER_ERROR_MESSAGES;
