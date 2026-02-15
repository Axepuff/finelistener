import { contextBridge, ipcRenderer } from 'electron';
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
    pickAudio: (lang: string) => ipcRenderer.invoke('pickAudio', lang),
    convertAudio: (args: any) => ipcRenderer.invoke('convertAudio', args),
    saveText: (content: string) => ipcRenderer.invoke('saveText', content),
    startSystemRecording: (options?: { fileName?: string; deviceId?: string }) => ipcRenderer.invoke('recording:start', options),
    stopSystemRecording: () => ipcRenderer.invoke('recording:stop'),
    getRecordingState: () => ipcRenderer.invoke('recording:get-state'),
    getRecordingPermissionStatus: () => ipcRenderer.invoke('recording:get-permission-status'),
    openRecordingPreferences: () => ipcRenderer.invoke('recording:open-permission-preferences'),
    isRecordingAvailable: () => ipcRenderer.invoke('recording:is-available'),
    listRecordingDevices: () => ipcRenderer.invoke('recording:list-devices'),
    revealDevAppInFinder: () => ipcRenderer.invoke('recording:reveal-dev-app'),
    transcribeStream: (audioPath: string, opts: any) => ipcRenderer.invoke('transcribeStream', audioPath, opts),
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
    onTranscribeText: (cb: (chunk: string) => void) => {
        const handler = (_e: unknown, chunk: string) => cb(chunk);

        ipcRenderer.on('transcribe:progress', handler);

        return () => ipcRenderer.removeListener('transcribe:progress', handler);
    },
    onTranscribeProgressValue: (cb: (value: number) => void) => {
        const handler = (_e: unknown, value: number) => cb(value);

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
