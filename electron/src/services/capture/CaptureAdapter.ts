import type { WavFormat } from 'electron/src/services/AudioPreprocessor';
import type { RecordingLevel, RecordingProgress, RecordingResult } from 'electron/src/services/RecordingService';

export interface CaptureAdapterStartOptions {
    outputPath: string;
    format: WavFormat;
    deviceId?: string;
}

export interface CaptureAdapterEvents {
    onLevel?: (level: RecordingLevel) => void;
    onProgress?: (progress: RecordingProgress) => void;
    onError?: (error: Error) => void;
}

export interface RecordingDevice {
    id: string;
    name: string;
    isDefault?: boolean;
    index?: number;
}

export interface CaptureAdapter {
    readonly id: string;
    readonly label: string;
    isAvailable?: () => Promise<boolean>;
    listDevices?: () => Promise<RecordingDevice[]>;
    startRecording(options: CaptureAdapterStartOptions, events: CaptureAdapterEvents): Promise<void>;
    stopRecording(): Promise<RecordingResult>;
}
