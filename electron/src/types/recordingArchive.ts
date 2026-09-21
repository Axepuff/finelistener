import type { SessionDetails } from './sessions';

export type RecoveryState = 'capturing' | 'ready' | 'recoverable' | 'committing';

export interface RecordingSourceWarning {
    source: 'system' | 'microphone';
    message: string;
}

export interface FinalizeRecordingResult {
    recordingId: string;
    sessionId: string;
    session: SessionDetails;
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
