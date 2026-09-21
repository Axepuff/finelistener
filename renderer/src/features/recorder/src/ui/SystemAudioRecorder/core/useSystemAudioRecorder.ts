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
    sourceLevels: Partial<Record<'system' | 'microphone', RecordingLevel>>;
    devices: RecordingDevice[];
    selectedDeviceId: string;
    showDeviceSelect: boolean;
    isWindows: boolean;
    sourceSelectionDisabled: boolean;
    systemDeviceId: string | null;
    microphoneDeviceId: string | null;
    onSourceChange: (source: 'system' | 'microphone', deviceId: string | null) => void;
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
    const isWindows = runtimePlatform === 'win32';

    const isRecordingActive = session.recordingState !== 'idle';
    const canStartRecording = appStore.isElectron
        && session.recordingState === 'idle'
        && !session.isProcessingRecording
        && !appStore.operations.isBusy
        && (!isWindows || (!devicesState.isLoading && (devicesState.systemDeviceId !== null || devicesState.microphoneDeviceId !== null)))
        && availability.isRecordingAvailable
        && availability.permissionStatus !== 'restricted';

    const canStopRecording = appStore.isElectron
        && !session.isProcessingRecording
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
            sourceLevels: session.sourceLevels,
            devices: devicesState.devices,
            selectedDeviceId: devicesState.selectedDeviceId,
            showDeviceSelect,
            isWindows,
            sourceSelectionDisabled: appStore.operations.isBusy || devicesState.isLoading,
            systemDeviceId: devicesState.systemDeviceId,
            microphoneDeviceId: devicesState.microphoneDeviceId,
            onSourceChange: (source, deviceId) => recordingStore.selectSource(source, deviceId),
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
