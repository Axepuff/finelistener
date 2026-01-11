import type { ConvertAudioOptions } from 'electron/src/services/AudioPreprocessor';
import type {
    RecordingLevel,
    RecordingProgress,
    RecordingResult,
    RecordingSession,
    RecordingStartOptions,
    RecordingState,
} from 'electron/src/services/RecordingService';
import type { ScreenRecordingPermissionStatus } from 'electron/src/services/recording/ScreenCaptureKitAdapter';
import React, { useEffect } from 'react';
import type { TranscribeOpts } from '../../electron/src/types/transcription';
import type { WhisperModelDownloadProgress, WhisperModelInfo, WhisperModelName } from '../../electron/src/types/whisper';
import { AppContext } from './AppContext';
import { Home } from './Home';

declare global {
    interface Window {
        api?: {
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
            onWhisperModelDownloadProgress: (cb: (payload: WhisperModelDownloadProgress) => void) => () => void;
            openDevTools: () => Promise<boolean>;
        };
    }
}

export const App: React.FC = () => {
    useEffect(() => {
        if (!window.api?.openDevTools) {
            return;
        }

        const targetSequence = 'iddqd';
        let buffer = '';

        const handleKeyDown = (event: KeyboardEvent) => {
            const key = event.key.toLowerCase();

            if (key.length !== 1) {
                buffer = '';

                return;
            }

            buffer = (buffer + key).slice(-targetSequence.length);

            if (buffer === targetSequence) {
                window.api
                    ?.openDevTools?.()
                    .catch((error: unknown) => console.error('Failed to open devtools', error));
                buffer = '';
            }
        };

        window.addEventListener('keydown', handleKeyDown);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

    return (
        <AppContext value={{ isElectron: !!window.api }}>
            <Home />
        </AppContext>
    );
};
