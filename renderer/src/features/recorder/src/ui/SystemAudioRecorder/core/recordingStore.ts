import type { SessionDetails } from 'electron/src/types/sessions';
import type { ActivityLogStore } from 'renderer/src/stores/activityLogStore';
import type { ForegroundOperationStore } from 'renderer/src/stores/foregroundOperationStore';
import type { RendererAdapter } from 'renderer/src/stores/rendererAdapter';
import type { CommandResult } from 'renderer/src/stores/types';
import { RecordingAvailabilityStore } from './stores/recordingAvailabilityStore';
import { RecordingDevicesStore } from './stores/recordingDevicesStore';
import { TranscriptionRecordingLogService } from './stores/recordingLogService';
import { RecordingSessionStore } from './stores/recordingSessionStore';
import type {
    RecordingAvailabilityState,
    RecordingDevicesState,
    RecordingSessionState,
} from './stores/recordingStoreTypes';
import { RecordingSupportActionsStore } from './stores/recordingSupportActionsStore';

interface SystemAudioRecorderStoreDependencies {
    adapter: RendererAdapter | null;
    activityLog: ActivityLogStore;
    operations: ForegroundOperationStore;
    onSessionImported: (session: SessionDetails) => void;
}

export class SystemAudioRecorderStore {
    private readonly logService: TranscriptionRecordingLogService;

    private readonly availabilityStore: RecordingAvailabilityStore;

    private readonly devicesStore: RecordingDevicesStore;

    private readonly sessionStore: RecordingSessionStore;

    private readonly supportActionsStore: RecordingSupportActionsStore;

    constructor(dependencies: SystemAudioRecorderStoreDependencies) {
        const recordingDependencies = { adapter: dependencies.adapter };

        this.logService = new TranscriptionRecordingLogService(dependencies.activityLog);
        this.availabilityStore = new RecordingAvailabilityStore(recordingDependencies);
        this.devicesStore = new RecordingDevicesStore(recordingDependencies);
        this.sessionStore = new RecordingSessionStore({
            ...recordingDependencies,
            logService: this.logService,
            availabilityStore: this.availabilityStore,
            devicesStore: this.devicesStore,
            operations: dependencies.operations,
            onSessionImported: dependencies.onSessionImported,
        });
        this.supportActionsStore = new RecordingSupportActionsStore({
            ...recordingDependencies,
            logService: this.logService,
        });
    }

    get availability(): Readonly<RecordingAvailabilityState> {
        return this.availabilityStore.state;
    }

    get devices(): Readonly<RecordingDevicesState> {
        return this.devicesStore.state;
    }

    get session(): Readonly<RecordingSessionState> {
        return this.sessionStore.state;
    }

    initialize(): void {
        void this.availabilityStore.initialize();
        void this.devicesStore.initialize();
        this.sessionStore.initialize();
    }

    dispose(): void {
        this.sessionStore.dispose();
    }

    selectDevice(deviceId: string): void {
        this.devicesStore.selectDevice(deviceId);
    }

    startRecording(): Promise<CommandResult> {
        return this.sessionStore.startRecording();
    }

    stopRecording(): Promise<CommandResult<SessionDetails>> {
        return this.sessionStore.stopRecording();
    }

    openRecordingPreferences(): Promise<void> {
        return this.supportActionsStore.openRecordingPreferences();
    }

    revealDevApp(): Promise<void> {
        return this.supportActionsStore.revealDevApp();
    }
}
