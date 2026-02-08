import type { ConvertAudioOptions } from 'electron/src/services/AudioPreprocessor';
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
import type { TranscribeOpts } from 'electron/src/types/transcription';
import type { WhisperModelDownloadProgress, WhisperModelInfo, WhisperModelName } from 'electron/src/types/whisper';

type RuntimePlatform = 'darwin' | 'win32' | 'linux';

declare global {
    interface Window {
        api?: {
            runtime: {
                platform: RuntimePlatform;
            };
            pickAudio: () => Promise<string | null>;
            transcribeStream: (audioPath: string, opts: TranscribeOpts) => Promise<string>;
            convertAudio: (args: ConvertAudioOptions) => Promise<{ path: string }>;
            saveText: (content: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
            startSystemRecording: (options?: RecordingStartOptions) => Promise<RecordingSession>;
            stopSystemRecording: () => Promise<RecordingResult>;
            getRecordingState: () => Promise<RecordingState>;
            getRecordingPermissionStatus: () => Promise<ScreenRecordingPermissionStatus>;
            openRecordingPreferences: () => Promise<boolean>;
            isRecordingAvailable: () => Promise<boolean>;
            listRecordingDevices: () => Promise<RecordingDevice[]>;
            revealDevAppInFinder: () => Promise<boolean>;
            onTranscribeText: (cb: (chunk: string) => void) => () => void;
            onTranscribeProgressValue: (cb: (value: number) => void) => () => void;
            onTranscribeLog: (cb: (line: string) => void) => () => void;
            onRecordingState: (cb: (state: RecordingState) => void) => () => void;
            onRecordingProgress: (cb: (progress: RecordingProgress) => void) => () => void;
            onRecordingLevel: (cb: (level: RecordingLevel) => void) => () => void;
            onRecordingError: (cb: (payload: { message: string }) => void) => () => void;
            stopTranscription: () => Promise<boolean>;
            getWhisperModels: () => Promise<WhisperModelInfo[]>;
            downloadWhisperModel: (modelName: WhisperModelName) => Promise<void>;
            importWhisperModelFromFile: () => Promise<
                | { ok: true; path: string; fileName: string }
                | { ok: false; error: string }
                | null
            >;
            onWhisperModelDownloadProgress: (cb: (payload: WhisperModelDownloadProgress) => void) => () => void;
            openDevTools: () => Promise<boolean>;
        };
    }
}

export {};
