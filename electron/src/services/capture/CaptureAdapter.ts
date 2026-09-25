import type { WavFormat } from 'electron/src/services/AudioPreprocessor';
import type { RecordingLevel, RecordingProgress, RecordingResult } from 'electron/src/services/RecordingService';

export type RecordingSourceKind = 'system' | 'microphone';

export interface RecordingSources {
    system?: string | null;
    microphone?: string | null;
}

export interface CaptureAdapterStartOptions {
    outputPath: string;
    format: WavFormat;
    deviceId?: string;
    sources?: RecordingSources;
}

export interface CaptureAdapterEvents {
    onLevel?: (level: RecordingLevel) => void;
    onProgress?: (progress: RecordingProgress) => void;
    onError?: (error: Error) => void;
    onFinished?: (result: RecordingResult) => void;
}

export interface RecordingDevice {
    id: string;
    name: string;
    isDefault?: boolean;
    index?: number;
    source?: RecordingSourceKind;
}

export interface CaptureAdapter {
    readonly id: string;
    readonly label: string;
    isAvailable?: () => Promise<boolean>;
    listDevices?: () => Promise<RecordingDevice[]>;
    startRecording(options: CaptureAdapterStartOptions, events: CaptureAdapterEvents): Promise<void>;
    stopRecording(): Promise<RecordingResult>;
}
