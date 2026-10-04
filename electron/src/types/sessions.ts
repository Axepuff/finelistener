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
    id?: string;
    startSec: number;
    endSec: number | null;
    text: string;
    source?: RecordingSource;
    words?: SessionRecognitionWord[];
    rawSpan?: SessionRawSpan;
    speakerId?: string | null;
}

export interface SessionRecognitionWord {
    startSec: number;
    endSec: number;
    text: string;
    startChar: number;
    endChar: number;
}

export interface SessionRawSpan {
    segmentId: string;
    startChar: number;
    endChar: number;
}

export type SessionAudioMode = 'original' | 'optimized';

export interface SessionSpeakerAssignment {
    recognitionRevision: string;
    generation: string;
    spans: SessionRawSpan[];
}

export interface SessionSpeakerProvenance {
    version: 1;
    engine: 'pyannote-community-1';
    modelRevision: string;
    runtimeRevision: string;
    audioMode: SessionAudioMode;
    backend: 'cpu' | 'cuda';
    range?: { start: number; end: number };
    speakerCount?: number;
    regularIntervals: SessionSpeakerInterval[];
    exclusiveIntervals: SessionSpeakerInterval[];
}

export interface SessionSpeakerInterval {
    startSec: number;
    endSec: number;
    speakerId: string;
}

export interface SessionSpeakerIdentity {
    id: string;
    name: string;
}

export interface SessionSpeakerCorrection extends SessionRawSpan {
    speakerId: string | null;
}

export interface SessionSpeakerMetadataV1 {
    version: 1;
    recognitionRevision: string;
    generation: string;
    settings: { speakerCount?: number; range?: { start: number; end: number } };
    provenance?: SessionSpeakerProvenance;
    intervals: SessionSpeakerInterval[];
    speakers: SessionSpeakerIdentity[];
    corrections: SessionSpeakerCorrection[];
    merges?: Array<{ fromId: string; toId: string }>;
    status: 'completed' | 'failed';
}

export interface TranscriptDuplicateFilterV1 {
    enabled: boolean;
    status: 'applied' | 'disabled' | 'failed';
    algorithm: 'cross-source-word-edit-v1';
    similarityThreshold: number;
    minimumMatchingWords: number;
    timeToleranceSec: number;
}

export interface SessionTranscriptPresentationV1 {
    duplicateFilter?: TranscriptDuplicateFilterV1;
}

export interface SessionTranscriptV1 {
    version: 1;
    segments: SessionTranscriptSegmentV1[];
    recognitionRevision?: string;
    recognitionSegments?: SessionTranscriptSegmentV1[];
    speakers?: SessionSpeakerMetadataV1;
    sourceRun?: SessionSourceRun;
    presentation?: SessionTranscriptPresentationV1;
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
    audioMode?: SessionAudioMode;
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
    audioMode?: SessionAudioMode;
    audioOriginalPath: string;
    audioWavPath: string;
    audioOptimizedWavPath?: string;
    transcript?: SessionTranscriptV1;
    transcription?: SessionTranscriptionInfo;
    tracks?: SessionSourceTrack[];
    sourceWarnings?: Array<{ source: RecordingSource; message: string }>;
}
