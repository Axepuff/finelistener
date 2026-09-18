import type { RecordingDevice } from 'electron/src/services/capture/CaptureAdapter';
import { makeAutoObservable, runInAction } from 'mobx';
import { getErrorMessage, getRecordingDeviceId } from '../recordingUtils';
import {
    initialDevicesState,
    type RecordingDependencies,
    type RecordingDevicesState,
} from './recordingStoreTypes';

const FALLBACK_DEVICES_STATE: RecordingDevicesState = {
    devices: [],
    selectedDeviceId: '',
    deviceError: null,
};

export class RecordingDevicesStore {
    private stateValue: RecordingDevicesState = initialDevicesState;

    constructor(private readonly dependencies: RecordingDependencies) {
        makeAutoObservable<this, 'dependencies'>(this, { dependencies: false }, { autoBind: true });
    }

    get state(): Readonly<RecordingDevicesState> {
        return this.stateValue;
    }

    selectDevice(deviceId: string): void {
        this.stateValue = { ...this.stateValue, selectedDeviceId: deviceId };
    }

    async initialize(): Promise<void> {
        try {
            const state = await this.loadDevicesState();

            runInAction(() => {
                this.stateValue = state;
            });
        } catch {
            runInAction(() => {
                this.stateValue = FALLBACK_DEVICES_STATE;
            });
        }
    }

    private async loadDevicesState(): Promise<RecordingDevicesState> {
        const api = this.dependencies.adapter;

        if (!api) {
            return initialDevicesState;
        }

        try {
            const list: RecordingDevice[] = await api.listRecordingDevices();
            const normalized = list ?? [];
            const preferred = normalized.find((device) => device.isDefault) ?? normalized[0];
            const selectedDeviceId = preferred ? getRecordingDeviceId(preferred) : '';

            return {
                devices: normalized,
                selectedDeviceId,
                deviceError: null,
            };
        } catch (error: unknown) {
            return {
                devices: [],
                selectedDeviceId: '',
                deviceError: getErrorMessage(error),
            };
        }
    }
}
