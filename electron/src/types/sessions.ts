import type { TranscribeOpts } from './transcription';

export type SessionSourceKind = 'imported' | 'recorded';
export type RecordingSource = 'system' | 'microphone';

export interface SessionSourceTrack {
    source: RecordingSource;
    filePath: string;
    startOffsetMs: number;
    durationMs?: number;
    failure?: string;
}

export interface SessionSourceResult {
    source: RecordingSource;
    status: 'pending' | 'completed' | 'failed';
    segments: SessionTranscriptSegmentV1[];
    error?: string;
}

export interface SessionSourceRun {
    status: 'incomplete' | 'completed';
    settings: Omit<TranscribeOpts, 'runId' | 'sessionId'> & { optimized?: boolean };
    sources: SessionSourceResult[];
}

export interface SessionTranscriptSegmentV1 {
    startSec: number;
    endSec: number | null;
    text: string;
    source?: RecordingSource;
}

export interface SessionTranscriptV1 {
    version: 1;
    segments: SessionTranscriptSegmentV1[];
    sourceRun?: SessionSourceRun;
}

export interface SessionAudioInfo {
    originalFileName: string;
    /**
     * Path relative to the session directory (e.g. "audio/original.m4a").
     */
    originalPath: string;
    /**
     * Path relative to the session directory of a WAV file used by the player and transcription.
     * If missing, the app falls back to `originalPath` (when it's a WAV) or generates it on demand.
     */
    wavPath?: string;
    /**
     * Path relative to the session directory of an optimized WAV (lowPass + highPass + dynanorm).
     * Generated on demand via `sessions:optimize-audio`.
     */
    optimizedWavPath?: string;
}

export interface SessionTranscriptInfo {
    /**
     * Path relative to the session directory (e.g. "transcript/transcript.v1.json").
     */
    path: string;
}

export interface SessionTranscriptionInfo {
    language?: string;
    model?: string;
    segment?: { start: number; end: number };
}

export interface SessionFileV1 {
    version: 1;
    id: string;
    recordingId?: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    sourceKind: SessionSourceKind;
    audio: SessionAudioInfo;
    transcript?: SessionTranscriptInfo;
    transcription?: SessionTranscriptionInfo;
    tracks?: SessionSourceTrack[];
    sourceWarnings?: Array<{ source: RecordingSource; message: string }>;
}

export interface SessionListItem {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    sourceKind: SessionSourceKind;
    hasTranscript: boolean;
}

export interface SessionDetails extends SessionListItem {
    audioOriginalPath: string;
    audioWavPath: string;
    audioOptimizedWavPath?: string;
    transcript?: SessionTranscriptV1;
    tracks?: SessionSourceTrack[];
    sourceWarnings?: Array<{ source: RecordingSource; message: string }>;
}
