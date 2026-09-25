import { contextBridge, ipcRenderer } from 'electron';
import type { RecordingStartOptions } from './src/services/RecordingService';
import type { FinalizeRecordingResult, RecoverableRecording, StartRecordingResult } from './src/types/recordingArchive';
import type { TranscribeOpts, SessionTranscribeOpts, TranscriptionTextEvent, TranscriptionProgressEvent } from './src/types/transcription';
import type { UiPreferenceKey, UiPreferenceValueMap } from './src/types/uiPreferences';

type WhisperModelDownloadProgressPayload = {
    name: string;
    percent: number | null;
    downloadedBytes: number;
    totalBytes: number | null;
};

contextBridge.exposeInMainWorld('api', {
    runtime: {
        platform: process.platform,
    },
    sessions: {
        list: () => ipcRenderer.invoke('sessions:list'),
        get: (sessionId: string) => ipcRenderer.invoke('sessions:get', sessionId),
        setActive: (sessionId: string | null) => ipcRenderer.invoke('sessions:set-active', sessionId),
        delete: (sessionId: string) => ipcRenderer.invoke('sessions:delete', sessionId),
        importAudio: () => ipcRenderer.invoke('sessions:import-audio'),
        optimizeAudio: (sessionId: string) => ipcRenderer.invoke('sessions:optimize-audio', sessionId),
        setTranscriptDuplicateFilter: (sessionId: string, enabled: boolean) =>
            ipcRenderer.invoke('sessions:set-transcript-duplicate-filter', sessionId, enabled),
        revealFolder: () => ipcRenderer.invoke('sessions:reveal-root'),
    },
    saveText: (content: string) => ipcRenderer.invoke('saveText', content),
    startSystemRecording: (options?: RecordingStartOptions): Promise<StartRecordingResult> => ipcRenderer.invoke('recording:start', options),
    stopSystemRecording: (): Promise<FinalizeRecordingResult> => ipcRenderer.invoke('recording:stop'),
    listRecoverableRecordings: (): Promise<RecoverableRecording[]> => ipcRenderer.invoke('recording:list-recoverable'),
    recoverRecording: (recordingId: string): Promise<FinalizeRecordingResult> => ipcRenderer.invoke('recording:recover', recordingId),
    discardRecording: (recordingId: string): Promise<boolean> => ipcRenderer.invoke('recording:discard', recordingId),
    getRecordingState: () => ipcRenderer.invoke('recording:get-state'),
    getRecordingPermissionStatus: () => ipcRenderer.invoke('recording:get-permission-status'),
    openRecordingPreferences: () => ipcRenderer.invoke('recording:open-permission-preferences'),
    isRecordingAvailable: () => ipcRenderer.invoke('recording:is-available'),
    listRecordingDevices: () => ipcRenderer.invoke('recording:list-devices'),
    revealDevAppInFinder: () => ipcRenderer.invoke('recording:reveal-dev-app'),
    transcribeStream: (audioPath: string, opts: TranscribeOpts) => ipcRenderer.invoke('transcribeStream', audioPath, opts),
    transcribeSession: (sessionId: string, opts: SessionTranscribeOpts) => ipcRenderer.invoke('transcribe:session', sessionId, opts),
    stopTranscription: () => ipcRenderer.invoke('stop-transcription'),
    getWhisperModels: () => ipcRenderer.invoke('whisper-models:list'),
    downloadWhisperModel: (modelName: string) => ipcRenderer.invoke('whisper-models:download', modelName),
    importWhisperModelFromFile: () => ipcRenderer.invoke('whisper-models:import-from-file'),
    openDevTools: () => ipcRenderer.invoke('debug:open-devtools'),
    getUiPreference: <K extends UiPreferenceKey>(key: K): Promise<UiPreferenceValueMap[K]> =>
        ipcRenderer.invoke('ui-preferences:get', key),
    setUiPreference: <K extends UiPreferenceKey>(
        key: K,
        value: UiPreferenceValueMap[K],
    ): Promise<UiPreferenceValueMap[K]> =>
        ipcRenderer.invoke('ui-preferences:set', key, value),
    onTranscribeText: (cb: (event: TranscriptionTextEvent) => void) => {
        const handler = (_e: unknown, event: TranscriptionTextEvent) => cb(event);

        ipcRenderer.on('transcribe:progress', handler);

        return () => ipcRenderer.removeListener('transcribe:progress', handler);
    },
    onTranscribeProgressValue: (cb: (event: TranscriptionProgressEvent) => void) => {
        const handler = (_e: unknown, event: TranscriptionProgressEvent) => cb(event);

        ipcRenderer.on('transcribe:progress-percent', handler);

        return () => ipcRenderer.removeListener('transcribe:progress-percent', handler);
    },
    onTranscribeLog: (cb: (line: string) => void) => {
        const handler = (_e: unknown, line: string) => cb(line);

        ipcRenderer.on('transcribe:log', handler);

        return () => ipcRenderer.removeListener('transcribe:log', handler);
    },
    onRecordingState: (cb: (state: string) => void) => {
        const handler = (_e: unknown, state: string) => cb(state);

        ipcRenderer.on('recording:state', handler);

        return () => ipcRenderer.removeListener('recording:state', handler);
    },
    onRecordingProgress: (cb: (progress: unknown) => void) => {
        const handler = (_e: unknown, progress: unknown) => cb(progress);

        ipcRenderer.on('recording:progress', handler);

        return () => ipcRenderer.removeListener('recording:progress', handler);
    },
    onRecordingLevel: (cb: (level: unknown) => void) => {
        const handler = (_e: unknown, level: unknown) => cb(level);

        ipcRenderer.on('recording:level', handler);

        return () => ipcRenderer.removeListener('recording:level', handler);
    },
    onRecordingFinished: (cb: (result: FinalizeRecordingResult) => void) => {
        const handler = (_e: unknown, result: FinalizeRecordingResult) => cb(result);

        ipcRenderer.on('recording:finished', handler);

        return () => ipcRenderer.removeListener('recording:finished', handler);
    },
    onRecordingError: (cb: (payload: { message: string }) => void) => {
        const handler = (_e: unknown, payload: { message: string }) => cb(payload);

        ipcRenderer.on('recording:error', handler);

        return () => ipcRenderer.removeListener('recording:error', handler);
    },
    onWhisperModelDownloadProgress: (
        cb: (payload: WhisperModelDownloadProgressPayload) => void,
    ) => {
        const handler = (
            _e: unknown,
            payload: WhisperModelDownloadProgressPayload,
        ) => cb(payload);

        ipcRenderer.on('whisper-models:download-progress', handler);

        return () => ipcRenderer.removeListener('whisper-models:download-progress', handler);
    },
});
