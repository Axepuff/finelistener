import { makeAutoObservable, runInAction } from 'mobx';
import type { UiPreferenceKey } from 'electron/src/types/uiPreferences';
import { getRecordingDeviceId } from '../recordingUtils';
import {
    initialDevicesState,
    type RecordingDependencies,
    type RecordingDevicesState,
} from './recordingStoreTypes';

export class RecordingDevicesStore {
    private stateValue: RecordingDevicesState = initialDevicesState;

    private lifecycleId = 0;

    private preferenceWrites = Promise.resolve();

    constructor(private readonly dependencies: RecordingDependencies) {
        makeAutoObservable<this, 'dependencies' | 'preferenceWrites'>(this, {
            dependencies: false,
            preferenceWrites: false,
        }, { autoBind: true });
    }

    get state(): Readonly<RecordingDevicesState> {
        return this.stateValue;
    }

    selectDevice(deviceId: string): void {
        this.stateValue = { ...this.stateValue, selectedDeviceId: deviceId };
    }

    selectSource(source: 'system' | 'microphone', deviceId: string | null): void {
        if (this.stateValue.isLoading) return;

        const field = source === 'system' ? 'systemDeviceId' : 'microphoneDeviceId';
        const key: UiPreferenceKey = source === 'system' ? 'recordingSystemDevice' : 'recordingMicrophoneDevice';

        this.stateValue = { ...this.stateValue, [field]: deviceId };
        this.preferenceWrites = this.preferenceWrites.then(async () => {
            await this.dependencies.adapter?.setUiPreference(key, deviceId);
        }).catch((error: unknown) => {
            console.error('Failed to save recording source preference', error);
            runInAction(() => {
                this.stateValue = { ...this.stateValue, deviceError: 'Device selection could not be saved.' };
            });
        });
    }

    async initialize(): Promise<void> {
        const lifecycleId = ++this.lifecycleId;
        const api = this.dependencies.adapter;

        this.stateValue = { ...this.stateValue, isLoading: true };
        if (!api) {
            this.stateValue = { ...initialDevicesState, isLoading: false };

            return;
        }

        try {
            const [devices, systemDeviceId, microphoneDeviceId] = await Promise.all([
                api.listRecordingDevices(),
                api.runtimePlatform === 'win32' ? api.getUiPreference('recordingSystemDevice') : '',
                api.runtimePlatform === 'win32' ? api.getUiPreference('recordingMicrophoneDevice') : '',
            ]);

            if (lifecycleId !== this.lifecycleId) return;

            const preferred = devices.find((device) => device.isDefault) ?? devices[0];

            runInAction(() => {
                this.stateValue = {
                    devices,
                    selectedDeviceId: preferred ? getRecordingDeviceId(preferred) : '',
                    systemDeviceId,
                    microphoneDeviceId,
                    deviceError: null,
                    isLoading: false,
                };
            });
        } catch (error: unknown) {
            console.error('Failed to load recording devices or preferences', error);
            if (lifecycleId !== this.lifecycleId) return;

            runInAction(() => {
                this.stateValue = { ...initialDevicesState, isLoading: false, deviceError: 'Recording devices could not be loaded.' };
            });
        }
    }

    dispose(): void {
        this.lifecycleId += 1;
    }
}
