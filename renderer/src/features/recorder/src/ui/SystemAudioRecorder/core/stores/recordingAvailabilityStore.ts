import { makeAutoObservable, runInAction } from 'mobx';
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
    private stateValue: RecordingAvailabilityState = initialAvailabilityState;

    constructor(private readonly dependencies: RecordingDependencies) {
        makeAutoObservable<this, 'dependencies'>(this, { dependencies: false }, { autoBind: true });
    }

    get state(): Readonly<RecordingAvailabilityState> {
        return this.stateValue;
    }

    async initialize(): Promise<void> {
        try {
            const state = await this.loadAvailabilityState();

            runInAction(() => {
                this.stateValue = state;
            });
        } catch {
            runInAction(() => {
                this.stateValue = FALLBACK_AVAILABILITY_STATE;
            });
        }
    }

    replaceState(state: RecordingAvailabilityState): void {
        this.stateValue = state;
    }

    private async loadAvailabilityState(): Promise<RecordingAvailabilityState> {
        const api = this.dependencies.adapter;

        if (!api) {
            return initialAvailabilityState;
        }

        const [permissionStatusResult, recordingAvailableResult] = await Promise.allSettled([
            api.getRecordingPermissionStatus(),
            api.isRecordingAvailable(),
        ]);

        return {
            permissionStatus: permissionStatusResult.status === 'fulfilled' ?
                permissionStatusResult.value :
                FALLBACK_AVAILABILITY_STATE.permissionStatus,
            isRecordingAvailable: recordingAvailableResult.status === 'fulfilled' ?
                Boolean(recordingAvailableResult.value) :
                FALLBACK_AVAILABILITY_STATE.isRecordingAvailable,
        };
    }
}
