import type {
    RecordingLevel,
    RecordingProgress,
    RecordingStartOptions,
    RecordingState,
} from 'electron/src/services/RecordingService';
import type { FinalizeRecordingResult, RecoverableRecording, StartRecordingResult } from 'electron/src/types/recordingArchive';
import type { RecordingDevice } from 'electron/src/services/capture/CaptureAdapter';
import type { ScreenRecordingPermissionStatus } from 'electron/src/services/capture/ScreenCaptureKitAdapter';
import type { SessionDetails, SessionListItem } from 'electron/src/types/sessions';
import type { TranscribeOpts, SessionTranscribeOpts, TranscriptionTextEvent, TranscriptionProgressEvent } from 'electron/src/types/transcription';
import type { UiPreferenceKey, UiPreferenceValueMap } from 'electron/src/types/uiPreferences';
import type { WhisperModelDownloadProgress, WhisperModelInfo, WhisperModelName } from 'electron/src/types/whisper';

type RuntimePlatform = 'darwin' | 'win32' | 'linux';

declare global {
    interface Window {
        api?: {
            runtime: {
                platform: RuntimePlatform;
            };
            sessions: {
                list: () => Promise<SessionListItem[]>;
                get: (sessionId: string) => Promise<SessionDetails>;
                setActive: (sessionId: string | null) => Promise<boolean>;
                delete: (sessionId: string) => Promise<boolean>;
                importAudio: () => Promise<SessionDetails | null>;
                optimizeAudio: (sessionId: string) => Promise<SessionDetails>;
                setTranscriptDuplicateFilter: (sessionId: string, enabled: boolean) => Promise<SessionDetails>;
                revealFolder: () => Promise<boolean>;
            };
            transcribeStream: (audioPath: string, opts: TranscribeOpts) => Promise<string>;
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
            onTranscribeText: (cb: (event: TranscriptionTextEvent) => void) => () => void;
            onTranscribeProgressValue: (cb: (event: TranscriptionProgressEvent) => void) => () => void;
            onTranscribeLog: (cb: (line: string) => void) => () => void;
            onRecordingState: (cb: (state: RecordingState) => void) => () => void;
            onRecordingProgress: (cb: (progress: RecordingProgress) => void) => () => void;
            onRecordingLevel: (cb: (level: RecordingLevel) => void) => () => void;
            onRecordingFinished: (callback: (result: FinalizeRecordingResult) => void) => () => void;
            onRecordingError: (cb: (payload: { message: string }) => void) => () => void;
            transcribeSession: (sessionId: string, options: SessionTranscribeOpts) => Promise<SessionDetails>;
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
            getUiPreference: <K extends UiPreferenceKey>(key: K) => Promise<UiPreferenceValueMap[K]>;
            setUiPreference: <K extends UiPreferenceKey>(
                key: K,
                value: UiPreferenceValueMap[K],
            ) => Promise<UiPreferenceValueMap[K]>;
        };
    }
}

export {};
