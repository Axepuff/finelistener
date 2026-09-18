import type { RecordingLevel, RecordingState } from 'electron/src/services/RecordingService';
import type { RecordingDevice } from 'electron/src/services/capture/CaptureAdapter';
import type { ScreenRecordingPermissionStatus } from 'electron/src/services/capture/ScreenCaptureKitAdapter';
import type { RendererAdapter } from 'renderer/src/stores/rendererAdapter';

export interface RecordingAvailabilityState {
    permissionStatus: ScreenRecordingPermissionStatus;
    isRecordingAvailable: boolean;
}

export interface RecordingDevicesState {
    devices: RecordingDevice[];
    selectedDeviceId: string;
    deviceError: string | null;
}

export interface RecordingSessionState {
    recordingState: RecordingState;
    recordingDurationMs: number;
    recordingBytesWritten: number | null;
    recordingLevel: RecordingLevel | null;
    showSilenceWarning: boolean;
    recordingError: string | null;
    isProcessingRecording: boolean;
    recordingStartAt: number | null;
    lastProgressAt: number | null;
    silenceStartedAt: number | null;
    silenceLogged: boolean;
}

export interface RecordingDependencies {
    adapter: RendererAdapter | null;
}

export const initialAvailabilityState: RecordingAvailabilityState = {
    permissionStatus: 'unknown',
    isRecordingAvailable: true,
};

export const initialDevicesState: RecordingDevicesState = {
    devices: [],
    selectedDeviceId: '',
    deviceError: null,
};

export const initialSessionState: RecordingSessionState = {
    recordingState: 'idle',
    recordingDurationMs: 0,
    recordingBytesWritten: null,
    recordingLevel: null,
    showSilenceWarning: false,
    recordingError: null,
    isProcessingRecording: false,
    recordingStartAt: null,
    lastProgressAt: null,
    silenceStartedAt: null,
    silenceLogged: false,
};
