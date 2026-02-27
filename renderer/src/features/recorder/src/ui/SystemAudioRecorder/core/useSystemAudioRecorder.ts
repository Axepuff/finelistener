import type { RecordingLevel, RecordingState } from 'electron/src/services/RecordingService';
import type { RecordingDevice } from 'electron/src/services/capture/CaptureAdapter';
import { useAtomValue, useSetAtom } from 'jotai';
import { useApp } from '../../../../../../AppContext';
import { recordingStore } from './recordingStore';

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
    const { isElectron } = useApp();
    const availability = useAtomValue(recordingStore.availabilityAtom);
    const devicesState = useAtomValue(recordingStore.devicesAtom);
    const session = useAtomValue(recordingStore.sessionAtom);

    const startRecording = useSetAtom(recordingStore.startRecordingAtom);
    const stopRecording = useSetAtom(recordingStore.stopRecordingAtom);
    const selectDevice = useSetAtom(recordingStore.selectDeviceAtom);
    const openRecordingPreferences = useSetAtom(recordingStore.openRecordingPreferencesAtom);
    const revealDevApp = useSetAtom(recordingStore.revealDevAppAtom);

    const runtimePlatform = isElectron ? window.api?.runtime?.platform ?? null : null;
    const isMacOS = runtimePlatform === 'darwin';

    const isRecordingActive = session.recordingState !== 'idle';
    const canStartRecording = isElectron
        && session.recordingState === 'idle'
        && !session.isProcessingRecording
        && availability.isRecordingAvailable
        && availability.permissionStatus !== 'restricted';

    const canStopRecording = isElectron
        && (session.recordingState === 'starting'
            || session.recordingState === 'recording'
            || session.recordingState === 'error');

    const showDeviceSelect = isElectron && devicesState.devices.length > 0;

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
            onStartRecording: startRecording,
            onStopRecording: stopRecording,
            onDeviceChange: selectDevice,
        },
        meter: {
            recordingState: session.recordingState,
            recordingLevel: session.recordingLevel,
        },
        alerts: {
            recordingError: session.recordingError,
            showSilenceWarning: session.showSilenceWarning,
            isMacOS,
            onOpenRecordingPreferences: openRecordingPreferences,
            onRevealDevApp: revealDevApp,
            deviceError: devicesState.deviceError,
            isRecordingAvailable: availability.isRecordingAvailable,
        },
    };
};
