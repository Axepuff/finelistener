import type { RecordingLevel, RecordingProgress, RecordingState } from 'electron/src/services/RecordingService';
import type { FinalizeRecordingResult } from 'electron/src/types/recordingArchive';
import type { TranscriptionTextEvent, TranscriptionProgressEvent } from 'electron/src/types/transcription';
import { UI_PREFERENCE_DEFAULTS, type UiPreferenceKey, type UiPreferenceValueMap } from '../../../../electron/src/types/uiPreferences';
import type { WhisperModelDownloadProgress } from 'electron/src/types/whisper';
import type { RendererAdapter } from '../rendererAdapter';

interface AdapterListeners {
    transcribeText: Set<(event: TranscriptionTextEvent) => void>;
    transcribeProgress: Set<(event: TranscriptionProgressEvent) => void>;
    transcribeLog: Set<(line: string) => void>;
    recordingState: Set<(state: RecordingState) => void>;
    recordingProgress: Set<(progress: RecordingProgress) => void>;
    recordingLevel: Set<(level: RecordingLevel) => void>;
    recordingFinished: Set<(result: FinalizeRecordingResult) => void>;
    recordingError: Set<(payload: { message: string }) => void>;
    modelDownloadProgress: Set<(payload: WhisperModelDownloadProgress) => void>;
}

export interface FakeRendererAdapterController {
    adapter: RendererAdapter;
    get activeListenerCount(): number;
    emitTranscribeText: (event: TranscriptionTextEvent) => void;
    emitTranscribeProgress: (event: TranscriptionProgressEvent) => void;
    emitTranscribeLog: (line: string) => void;
}

const subscribe = <T>(listeners: Set<(payload: T) => void>, callback: (payload: T) => void): (() => void) => {
    listeners.add(callback);

    return () => {
        listeners.delete(callback);
    };
};

export const createFakeRendererAdapter = (
    overrides: Partial<RendererAdapter> = {},
): FakeRendererAdapterController => {
    const listeners: AdapterListeners = {
        transcribeText: new Set(),
        transcribeProgress: new Set(),
        transcribeLog: new Set(),
        recordingState: new Set(),
        recordingProgress: new Set(),
        recordingLevel: new Set(),
        recordingFinished: new Set(),
        recordingError: new Set(),
        modelDownloadProgress: new Set(),
    };
    const unavailable = (): Promise<never> => Promise.reject(
        new Error('Not configured in fake renderer adapter'),
    );
    const adapter: RendererAdapter = {
        runtimePlatform: 'linux',
        listSessions: () => Promise.resolve([]),
        getSession: unavailable,
        setActiveSession: () => Promise.resolve(true),
        deleteSession: () => Promise.resolve(true),
        importAudio: () => Promise.resolve(null),
        optimizeAudio: unavailable,
        setTranscriptDuplicateFilter: unavailable,
        revealSessionsFolder: () => Promise.resolve(true),
        transcribe: () => Promise.resolve(''),
        transcribeSession: unavailable,
        stopTranscription: () => Promise.resolve(false),
        saveText: () => Promise.resolve({ ok: true }),
        startSystemRecording: unavailable,
        stopSystemRecording: unavailable,
        listRecoverableRecordings: () => Promise.resolve([]),
        recoverRecording: unavailable,
        discardRecording: unavailable,
        getRecordingState: () => Promise.resolve('idle'),
        getRecordingPermissionStatus: () => Promise.resolve('unknown'),
        openRecordingPreferences: () => Promise.resolve(false),
        isRecordingAvailable: () => Promise.resolve(false),
        listRecordingDevices: () => Promise.resolve([]),
        revealDevAppInFinder: () => Promise.resolve(false),
        getWhisperModels: () => Promise.resolve([]),
        downloadWhisperModel: () => Promise.resolve(),
        importWhisperModelFromFile: () => Promise.resolve(null),
        openDevTools: () => Promise.resolve(true),
        getUiPreference: <K extends UiPreferenceKey>(key: K) => (
            Promise.resolve(UI_PREFERENCE_DEFAULTS[key])
        ),
        setUiPreference: <K extends UiPreferenceKey>(
            _key: K,
            value: UiPreferenceValueMap[K],
        ) => Promise.resolve(value),
        onTranscribeText: (callback) => subscribe(listeners.transcribeText, callback),
        onTranscribeProgress: (callback) => subscribe(listeners.transcribeProgress, callback),
        onTranscribeLog: (callback) => subscribe(listeners.transcribeLog, callback),
        onRecordingState: (callback) => subscribe(listeners.recordingState, callback),
        onRecordingProgress: (callback) => subscribe(listeners.recordingProgress, callback),
        onRecordingLevel: (callback) => subscribe(listeners.recordingLevel, callback),
        onRecordingFinished: (callback) => subscribe(listeners.recordingFinished, callback),
        onRecordingError: (callback) => subscribe(listeners.recordingError, callback),
        onWhisperModelDownloadProgress: (callback) => subscribe(listeners.modelDownloadProgress, callback),
        ...overrides,
    };

    return {
        adapter,
        get activeListenerCount() {
            return listeners.transcribeText.size +
                listeners.transcribeProgress.size +
                listeners.transcribeLog.size +
                listeners.recordingState.size +
                listeners.recordingProgress.size +
                listeners.recordingLevel.size +
                listeners.recordingFinished.size +
                listeners.recordingError.size +
                listeners.modelDownloadProgress.size;
        },
        emitTranscribeText: (chunk) => listeners.transcribeText.forEach((callback) => callback(chunk)),
        emitTranscribeProgress: (value) => listeners.transcribeProgress.forEach((callback) => callback(value)),
        emitTranscribeLog: (line) => listeners.transcribeLog.forEach((callback) => callback(line)),
    };
};
