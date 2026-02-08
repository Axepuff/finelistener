import { RecordingAvailabilityStore } from './stores/recordingAvailabilityStore';
import { RecordingDevicesStore } from './stores/recordingDevicesStore';
import { TranscriptionRecordingLogService } from './stores/recordingLogService';
import { RecordingSessionStore } from './stores/recordingSessionStore';
import type { RecordingDependencies } from './stores/recordingStoreTypes';
import { RecordingSupportActionsStore } from './stores/recordingSupportActionsStore';

const recordingDependencies: RecordingDependencies = {
    getApi: () => window.api ?? null,
};

export class SystemAudioRecorderStore {
    private readonly logService = new TranscriptionRecordingLogService();

    private readonly availabilityStore = new RecordingAvailabilityStore(recordingDependencies);

    private readonly devicesStore = new RecordingDevicesStore(recordingDependencies);

    private readonly sessionStore = new RecordingSessionStore({
        ...recordingDependencies,
        logService: this.logService,
        availabilityAtom: this.availabilityStore.availabilityAtom,
        devicesAtom: this.devicesStore.devicesAtom,
    });

    private readonly supportActionsStore = new RecordingSupportActionsStore({
        ...recordingDependencies,
        logService: this.logService,
    });

    readonly availabilityAtom = this.availabilityStore.availabilityAtom;

    readonly devicesAtom = this.devicesStore.devicesAtom;

    readonly sessionAtom = this.sessionStore.sessionAtom;

    readonly selectDeviceAtom = this.devicesStore.selectDeviceAtom;

    readonly startRecordingAtom = this.sessionStore.startRecordingAtom;

    readonly stopRecordingAtom = this.sessionStore.stopRecordingAtom;

    readonly openRecordingPreferencesAtom = this.supportActionsStore.openRecordingPreferencesAtom;

    readonly revealDevAppAtom = this.supportActionsStore.revealDevAppAtom;
}

export const recordingStore = new SystemAudioRecorderStore();
