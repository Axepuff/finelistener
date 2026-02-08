import type { RecordingDevice } from 'electron/src/services/capture/CaptureAdapter';
import { atom } from 'jotai';
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
    // Stores output devices list, selected device, and device-loading error state.
    readonly devicesAtom = atom<RecordingDevicesState>(initialDevicesState);

    readonly selectDeviceAtom = atom(null, (_get, set, deviceId: string) => {
        set(this.devicesAtom, (prev) => ({
            ...prev,
            selectedDeviceId: deviceId,
        }));
    });

    constructor(private readonly dependencies: RecordingDependencies) {
        this.devicesAtom.onMount = (setSelf) => {
            void this.loadDevicesState()
                .then((state) => {
                    setSelf(state);
                })
                .catch(() => {
                    setSelf(FALLBACK_DEVICES_STATE);
                });

            return undefined;
        };
    }

    private async loadDevicesState(): Promise<RecordingDevicesState> {
        const api = this.dependencies.getApi();

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
