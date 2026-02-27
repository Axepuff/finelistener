import { atom } from 'jotai';
import {
    initialAvailabilityState,
    type RecordingAvailabilityState,
    type RecordingDependencies,
} from './recordingStoreTypes';

const FALLBACK_AVAILABILITY_STATE: RecordingAvailabilityState = {
    permissionStatus: 'unknown',
    isRecordingAvailable: false,
};

export class RecordingAvailabilityStore {
    // Reflects recorder permission status and helper availability in the UI.
    readonly availabilityAtom = atom<RecordingAvailabilityState>(initialAvailabilityState);

    constructor(private readonly dependencies: RecordingDependencies) {
        this.availabilityAtom.onMount = (setSelf) => {
            void this.loadAvailabilityState()
                .then((state) => {
                    setSelf(state);
                })
                .catch(() => {
                    setSelf(FALLBACK_AVAILABILITY_STATE);
                });

            return undefined;
        };
    }

    private async loadAvailabilityState(): Promise<RecordingAvailabilityState> {
        const api = this.dependencies.getApi();

        if (!api) {
            return initialAvailabilityState;
        }

        const [permissionStatusResult, recordingAvailableResult] = await Promise.allSettled([
            api.getRecordingPermissionStatus(),
            api.isRecordingAvailable(),
        ]);

        return {
            permissionStatus: permissionStatusResult.status === 'fulfilled'
                ? permissionStatusResult.value
                : FALLBACK_AVAILABILITY_STATE.permissionStatus,
            isRecordingAvailable: recordingAvailableResult.status === 'fulfilled'
                ? Boolean(recordingAvailableResult.value)
                : FALLBACK_AVAILABILITY_STATE.isRecordingAvailable,
        };
    }
}
