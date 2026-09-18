import type { RecordingLevel, RecordingState } from 'electron/src/services/RecordingService';
import type { RecordingDevice } from 'electron/src/services/capture/CaptureAdapter';
import { useAppStore } from '../../../../../../AppContext';

interface ControlsViewModel {
    canStartRecording: boolean;
    canStopRecording: boolean;
    isProcessingRecording: boolean;
    isRecordingActive: boolean;
    recordingDurationMs: number;
    recordingLevel: RecordingLevel | null;
    recordingBytesWritten: number | null;
    devices: RecordingDevice[];
    selectedDeviceId: string;
    showDeviceSelect: boolean;
    onStartRecording: () => void;
    onStopRecording: () => void;
    onDeviceChange: (deviceId: string) => void;
}

interface LevelMeterViewModel {
    recordingState: RecordingState;
    recordingLevel: RecordingLevel | null;
}

interface AlertsViewModel {
    recordingError: string | null;
    showSilenceWarning: boolean;
    isMacOS: boolean;
    onOpenRecordingPreferences: () => void;
    onRevealDevApp: () => void;
    deviceError: string | null;
    isRecordingAvailable: boolean;
}

export interface SystemAudioRecorderViewModel {
    controls: ControlsViewModel;
    meter: LevelMeterViewModel;
    alerts: AlertsViewModel;
}

export const useSystemAudioRecorder = (): SystemAudioRecorderViewModel => {
    const appStore = useAppStore();
    const { recording: recordingStore } = appStore;
    const availability = recordingStore.availability;
    const devicesState = recordingStore.devices;
    const session = recordingStore.session;
    const runtimePlatform = appStore.runtimePlatform;
    const isMacOS = runtimePlatform === 'darwin';

    const isRecordingActive = session.recordingState !== 'idle';
    const canStartRecording = appStore.isElectron
        && session.recordingState === 'idle'
        && !session.isProcessingRecording
        && !appStore.operations.isBusy
        && availability.isRecordingAvailable
        && availability.permissionStatus !== 'restricted';

    const canStopRecording = appStore.isElectron
        && (appStore.operations.kind === 'recording' || appStore.operations.kind === 'processing-recording')
        && (session.recordingState === 'starting'
            || session.recordingState === 'recording'
            || session.recordingState === 'error');

    const showDeviceSelect = appStore.isElectron && devicesState.devices.length > 0;

    return {
        controls: {
            canStartRecording,
            canStopRecording,
            isProcessingRecording: session.isProcessingRecording,
            isRecordingActive,
            recordingDurationMs: session.recordingDurationMs,
            recordingLevel: session.recordingLevel,
            recordingBytesWritten: session.recordingBytesWritten,
            devices: devicesState.devices,
            selectedDeviceId: devicesState.selectedDeviceId,
            showDeviceSelect,
            onStartRecording: () => void recordingStore.startRecording(),
            onStopRecording: () => void recordingStore.stopRecording(),
            onDeviceChange: (deviceId) => recordingStore.selectDevice(deviceId),
        },
        meter: {
            recordingState: session.recordingState,
            recordingLevel: session.recordingLevel,
        },
        alerts: {
            recordingError: session.recordingError,
            showSilenceWarning: session.showSilenceWarning,
            isMacOS,
            onOpenRecordingPreferences: () => void recordingStore.openRecordingPreferences(),
            onRevealDevApp: () => void recordingStore.revealDevApp(),
            deviceError: devicesState.deviceError,
            isRecordingAvailable: availability.isRecordingAvailable,
        },
    };
};
