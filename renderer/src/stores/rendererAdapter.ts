import type {
    RecordingLevel,
    RecordingProgress,
    RecordingResult,
    RecordingSession,
    RecordingStartOptions,
    RecordingState,
} from 'electron/src/services/RecordingService';
import type { RecordingDevice } from 'electron/src/services/capture/CaptureAdapter';
import type { ScreenRecordingPermissionStatus } from 'electron/src/services/capture/ScreenCaptureKitAdapter';
import type { SessionDetails, SessionListItem } from 'electron/src/types/sessions';
import type { TranscribeOpts, SessionTranscribeOpts, TranscriptionTextEvent, TranscriptionProgressEvent } from 'electron/src/types/transcription';
import type { UiPreferenceKey, UiPreferenceValueMap } from 'electron/src/types/uiPreferences';
import type { WhisperModelDownloadProgress, WhisperModelInfo, WhisperModelName } from 'electron/src/types/whisper';

export interface RendererAdapter {
    readonly runtimePlatform: 'darwin' | 'win32' | 'linux';
    listSessions: () => Promise<SessionListItem[]>;
    getSession: (sessionId: string) => Promise<SessionDetails>;
    deleteSession: (sessionId: string) => Promise<boolean>;
    importAudio: () => Promise<SessionDetails | null>;
    importRecording: (recordingFilePath: string | RecordingResult) => Promise<SessionDetails>;
    optimizeAudio: (sessionId: string) => Promise<SessionDetails>;
    revealSessionsFolder: () => Promise<boolean>;
    transcribe: (audioPath: string, options: TranscribeOpts) => Promise<string>;
    transcribeSession: (sessionId: string, options: SessionTranscribeOpts) => Promise<SessionDetails>;
    stopTranscription: () => Promise<boolean>;
    saveText: (content: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
    startSystemRecording: (options?: RecordingStartOptions) => Promise<RecordingSession>;
    stopSystemRecording: () => Promise<RecordingResult>;
    getRecordingState: () => Promise<RecordingState>;
    getRecordingPermissionStatus: () => Promise<ScreenRecordingPermissionStatus>;
    openRecordingPreferences: () => Promise<boolean>;
    isRecordingAvailable: () => Promise<boolean>;
    listRecordingDevices: () => Promise<RecordingDevice[]>;
    revealDevAppInFinder: () => Promise<boolean>;
    getWhisperModels: () => Promise<WhisperModelInfo[]>;
    downloadWhisperModel: (modelName: WhisperModelName) => Promise<void>;
    importWhisperModelFromFile: () => Promise<
        | { ok: true; path: string; fileName: string }
        | { ok: false; error: string }
        | null
    >;
    openDevTools: () => Promise<boolean>;
    getUiPreference: <K extends UiPreferenceKey>(key: K) => Promise<UiPreferenceValueMap[K]>;
    setUiPreference: <K extends UiPreferenceKey>(
        key: K,
        value: UiPreferenceValueMap[K],
    ) => Promise<UiPreferenceValueMap[K]>;
    onTranscribeText: (callback: (event: TranscriptionTextEvent) => void) => () => void;
    onTranscribeProgress: (callback: (event: TranscriptionProgressEvent) => void) => () => void;
    onTranscribeLog: (callback: (line: string) => void) => () => void;
    onRecordingState: (callback: (state: RecordingState) => void) => () => void;
    onRecordingProgress: (callback: (progress: RecordingProgress) => void) => () => void;
    onRecordingLevel: (callback: (level: RecordingLevel) => void) => () => void;
    onRecordingFinished: (callback: (result: RecordingResult) => void) => () => void;
    onRecordingError: (callback: (payload: { message: string }) => void) => () => void;
    onWhisperModelDownloadProgress: (callback: (payload: WhisperModelDownloadProgress) => void) => () => void;
}

export const createPreloadAdapter = (api?: Window['api']): RendererAdapter | null => {
    if (!api) return null;

    return {
        runtimePlatform: api.runtime.platform,
        listSessions: () => api.sessions.list(),
        getSession: (sessionId) => api.sessions.get(sessionId),
        deleteSession: (sessionId) => api.sessions.delete(sessionId),
        importAudio: () => api.sessions.importAudio(),
        importRecording: (recordingFilePath) => api.sessions.importRecording(recordingFilePath),
        optimizeAudio: (sessionId) => api.sessions.optimizeAudio(sessionId),
        revealSessionsFolder: () => api.sessions.revealFolder(),
        transcribe: (audioPath, options) => api.transcribeStream(audioPath, options),
        transcribeSession: (sessionId, options) => api.transcribeSession(sessionId, options),
        stopTranscription: () => api.stopTranscription(),
        saveText: (content) => api.saveText(content),
        startSystemRecording: (options) => api.startSystemRecording(options),
        stopSystemRecording: () => api.stopSystemRecording(),
        getRecordingState: () => api.getRecordingState(),
        getRecordingPermissionStatus: () => api.getRecordingPermissionStatus(),
        openRecordingPreferences: () => api.openRecordingPreferences(),
        isRecordingAvailable: () => api.isRecordingAvailable(),
        listRecordingDevices: () => api.listRecordingDevices(),
        revealDevAppInFinder: () => api.revealDevAppInFinder(),
        getWhisperModels: () => api.getWhisperModels(),
        downloadWhisperModel: (modelName) => api.downloadWhisperModel(modelName),
        importWhisperModelFromFile: () => api.importWhisperModelFromFile(),
        openDevTools: () => api.openDevTools(),
        getUiPreference: (key) => api.getUiPreference(key),
        setUiPreference: (key, value) => api.setUiPreference(key, value),
        onTranscribeText: (callback) => api.onTranscribeText(callback),
        onTranscribeProgress: (callback) => api.onTranscribeProgressValue(callback),
        onTranscribeLog: (callback) => api.onTranscribeLog(callback),
        onRecordingState: (callback) => api.onRecordingState(callback),
        onRecordingProgress: (callback) => api.onRecordingProgress(callback),
        onRecordingLevel: (callback) => api.onRecordingLevel(callback),
        onRecordingFinished: (callback) => api.onRecordingFinished(callback),
        onRecordingError: (callback) => api.onRecordingError(callback),
        onWhisperModelDownloadProgress: (callback) => api.onWhisperModelDownloadProgress(callback),
    };
};
