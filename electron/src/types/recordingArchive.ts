export type RecoveryState = 'capturing' | 'ready' | 'recoverable' | 'committing';

export const RECORDING_STORAGE_FULL_MESSAGE = 'Recording storage is full. Recover or delete an unfinished recording before starting a new one.';

export interface RecordingSourceWarning {
    source: 'system' | 'microphone';
    message: string;
}

export interface FinalizeRecordingResult {
    recordingId: string;
    sessionId: string;
    sourceWarnings: RecordingSourceWarning[];
}

export interface RecoverableRecording {
    recordingId: string;
    createdAt: number;
    ageMs: number;
    sizeBytes: number;
    state: RecoveryState | 'unknown';
    sources: Array<'system' | 'microphone'>;
    sourceWarnings: RecordingSourceWarning[];
    canRecover: boolean;
}

export interface RecordingSessionInfo {
    recordingId: string;
    startedAt: number;
}

export type StartRecordingResult = RecordingSessionInfo | { error: 'recording-storage-full' };
