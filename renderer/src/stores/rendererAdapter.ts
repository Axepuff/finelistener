import type {
    RecordingLevel,
    RecordingProgress,
    RecordingStartOptions,
    RecordingState,
} from 'electron/src/services/RecordingService';
import type { FinalizeRecordingResult, RecoverableRecording, StartRecordingResult } from 'electron/src/types/recordingArchive';
import type { RecordingDevice } from 'electron/src/services/capture/CaptureAdapter';
import type { ScreenRecordingPermissionStatus } from 'electron/src/services/capture/ScreenCaptureKitAdapter';
import type { SessionDetails, SessionListItem, SessionRawSpan, SessionSpeakerAssignment } from 'electron/src/types/sessions';
import type { AnalyzeSpeakersOptions, SpeakerAnalysisProgressEvent, SpeakerAssetStatus, TranscribeOpts, SessionTranscribeOpts, TranscriptionTextEvent, TranscriptionProgressEvent } from 'electron/src/types/transcription';
import type { UiPreferenceKey, UiPreferenceValueMap } from 'electron/src/types/uiPreferences';
import type { WhisperModelDownloadProgress, WhisperModelInfo, WhisperModelName } from 'electron/src/types/whisper';

export interface RendererAdapter {
    readonly runtimePlatform: 'darwin' | 'win32' | 'linux';
    listSessions: () => Promise<SessionListItem[]>;
    getSession: (sessionId: string) => Promise<SessionDetails>;
    setActiveSession: (sessionId: string | null) => Promise<boolean>;
    deleteSession: (sessionId: string) => Promise<boolean>;
    importAudio: () => Promise<SessionDetails | null>;
    optimizeAudio: (sessionId: string, mode?: 'original' | 'optimized') => Promise<SessionDetails>;
    setTranscriptDuplicateFilter: (sessionId: string, enabled: boolean) => Promise<SessionDetails>;
    analyzeSpeakers: (sessionId: string, options: AnalyzeSpeakersOptions) => Promise<SessionDetails>;
    stopSpeakerAnalysis: () => Promise<boolean>;
    getSpeakerAssets: () => Promise<SpeakerAssetStatus>;
    prepareSpeakerAssets: () => Promise<SpeakerAssetStatus>;
    renameSpeaker: (sessionId: string, speakerId: string, name: string) => Promise<SessionDetails>;
    assignSpeaker: (sessionId: string, span: SessionRawSpan | SessionSpeakerAssignment, speakerId: string | null) => Promise<SessionDetails>;
    mergeSpeakers: (sessionId: string, sourceId: string | null, targetId: string | null) => Promise<SessionDetails>;
    revealSessionsFolder: () => Promise<boolean>;
    transcribe: (audioPath: string, options: TranscribeOpts) => Promise<string>;
    transcribeSession: (sessionId: string, options: SessionTranscribeOpts) => Promise<SessionDetails>;
    stopTranscription: () => Promise<boolean>;
    saveText: (content: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
    startSystemRecording: (options?: RecordingStartOptions) => Promise<StartRecordingResult>;
    stopSystemRecording: () => Promise<FinalizeRecordingResult>;
    listRecoverableRecordings: () => Promise<RecoverableRecording[]>;
    recoverRecording: (recordingId: string) => Promise<FinalizeRecordingResult>;
    discardRecording: (recordingId: string) => Promise<boolean>;
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
    onSpeakerAnalysisProgress: (callback: (event: SpeakerAnalysisProgressEvent) => void) => () => void;
    onRecordingState: (callback: (state: RecordingState) => void) => () => void;
    onRecordingProgress: (callback: (progress: RecordingProgress) => void) => () => void;
    onRecordingLevel: (callback: (level: RecordingLevel) => void) => () => void;
    onRecordingFinished: (callback: (result: FinalizeRecordingResult) => void) => () => void;
    onRecordingError: (callback: (payload: { message: string }) => void) => () => void;
    onWhisperModelDownloadProgress: (callback: (payload: WhisperModelDownloadProgress) => void) => () => void;
}

export const createPreloadAdapter = (api?: Window['api']): RendererAdapter | null => {
    if (!api) return null;

    return {
        runtimePlatform: api.runtime.platform,
        listSessions: () => api.sessions.list(),
        getSession: (sessionId) => api.sessions.get(sessionId),
        setActiveSession: (sessionId) => api.sessions.setActive(sessionId),
        deleteSession: (sessionId) => api.sessions.delete(sessionId),
        importAudio: () => api.sessions.importAudio(),
        optimizeAudio: (sessionId, mode) => api.sessions.optimizeAudio(sessionId, mode),
        setTranscriptDuplicateFilter: (sessionId, enabled) => api.sessions.setTranscriptDuplicateFilter(sessionId, enabled),
        analyzeSpeakers: (sessionId, options) => api.sessions.analyzeSpeakers(sessionId, options),
        stopSpeakerAnalysis: () => api.sessions.stopSpeakerAnalysis(),
        getSpeakerAssets: () => api.sessions.getSpeakerAssets(),
        prepareSpeakerAssets: () => api.sessions.prepareSpeakerAssets(),
        renameSpeaker: (sessionId, speakerId, name) => api.sessions.renameSpeaker(sessionId, speakerId, name),
        assignSpeaker: (sessionId, span, speakerId) => api.sessions.assignSpeaker(sessionId, span, speakerId),
        mergeSpeakers: (sessionId, sourceId, targetId) => api.sessions.mergeSpeakers(sessionId, sourceId, targetId),
        revealSessionsFolder: () => api.sessions.revealFolder(),
        transcribe: (audioPath, options) => api.transcribeStream(audioPath, options),
        transcribeSession: (sessionId, options) => api.transcribeSession(sessionId, options),
        stopTranscription: () => api.stopTranscription(),
        saveText: (content) => api.saveText(content),
        startSystemRecording: (options) => api.startSystemRecording(options),
        stopSystemRecording: () => api.stopSystemRecording(),
        listRecoverableRecordings: () => api.listRecoverableRecordings(),
        recoverRecording: (recordingId) => api.recoverRecording(recordingId),
        discardRecording: (recordingId) => api.discardRecording(recordingId),
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
        onSpeakerAnalysisProgress: (callback) => api.onSpeakerAnalysisProgress(callback),
        onRecordingState: (callback) => api.onRecordingState(callback),
        onRecordingProgress: (callback) => api.onRecordingProgress(callback),
        onRecordingLevel: (callback) => api.onRecordingLevel(callback),
        onRecordingFinished: (callback) => api.onRecordingFinished(callback),
        onRecordingError: (callback) => api.onRecordingError(callback),
        onWhisperModelDownloadProgress: (callback) => api.onWhisperModelDownloadProgress(callback),
    };
};
