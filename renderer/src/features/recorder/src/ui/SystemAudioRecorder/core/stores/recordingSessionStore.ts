import type {
    RecordingLevel,
    RecordingProgress,
    RecordingState,
} from 'electron/src/services/RecordingService';
import type { RecordingSourceKind } from 'electron/src/services/capture/CaptureAdapter';
import type { FinalizeRecordingResult } from 'electron/src/types/recordingArchive';
import type { SessionDetails } from 'electron/src/types/sessions';
import { makeAutoObservable, runInAction } from 'mobx';
import type { ForegroundOperationStore } from 'renderer/src/stores/foregroundOperationStore';
import {
    commandFailure,
    commandSuccess,
    type CommandResult,
    type ForegroundOperation,
} from 'renderer/src/stores/types';
import { getErrorMessage } from '../recordingUtils';
import type { RecordingAvailabilityStore } from './recordingAvailabilityStore';
import type { RecordingDevicesStore } from './recordingDevicesStore';
import type { RecordingLogService } from './recordingLogService';
import {
    type RecordingDependencies,
    type RecordingSessionState,
    initialSessionState,
} from './recordingStoreTypes';

const RECORDING_STORAGE_FULL_MESSAGE = 'Recording storage is full. Recover or delete an unfinished recording before starting a new one.';

// Peak and RMS are normalized linear amplitudes. Both below 0.0005 is effectively silent (about −66 dBFS).
const silenceThreshold = 0.0005;

interface RecordingSessionDependencies extends RecordingDependencies {
    logService: RecordingLogService;
    availabilityStore: RecordingAvailabilityStore;
    devicesStore: RecordingDevicesStore;
    operations: ForegroundOperationStore;
    onSessionImported: (session: SessionDetails, transcribe: boolean) => void;
    onRecoveryChanged: () => void;
}

const clearSessionBeforeStart = (previous: RecordingSessionState): RecordingSessionState => ({
    ...previous,
    recordingError: null,
    recordingLevel: null,
    sourceLevels: {},
    lastSourceSignalMs: {},
    recordingDurationMs: 0,
    recordingBytesWritten: null,
    recordingStartAt: null,
    lastProgressAt: null,
});

const applyRecordingState = (previous: RecordingSessionState, state: RecordingState): RecordingSessionState => {
    const next: RecordingSessionState = { ...previous, recordingState: state };

    if (state === 'recording' && !previous.recordingStartAt) {
        next.recordingStartAt = Date.now();
        // A live capture helper may emit no samples at all while its source is silent.
        next.lastSourceSignalMs = Object.fromEntries(previous.recordingSources.map((source) => [source, previous.recordingDurationMs]));
    }

    if (state !== 'recording') {
        next.recordingStartAt = null;
        next.lastProgressAt = null;
        next.lastSourceSignalMs = {};
    }

    return next;
};

const applyRecordingProgress = (
    previous: RecordingSessionState,
    progress: RecordingProgress,
): RecordingSessionState => {
    const lastProgressAt = Date.now();
    const recordingDurationMs = Number.isFinite(progress.durationMs) ? Math.max(previous.recordingDurationMs, progress.durationMs) : previous.recordingDurationMs;
    return {
        ...previous,
        recordingDurationMs,
        recordingStartAt: previous.recordingState === 'recording' ? lastProgressAt - recordingDurationMs : previous.recordingStartAt,
        sourceLevels: Object.fromEntries(Object.entries(previous.sourceLevels).filter(([source]) =>
            !progress.sourceFailures?.some((failure) => failure.source === source))),
        lastSourceSignalMs: Object.fromEntries(Object.entries(previous.lastSourceSignalMs).filter(([source]) =>
            !progress.sourceFailures?.some((failure) => failure.source === source))),
        recordingBytesWritten: typeof progress.bytesWritten === 'number' ? progress.bytesWritten : null,
        lastProgressAt,
        recordingError: progress.sourceFailures?.length ? progress.sourceFailures.map((failure) =>
            `${failure.source === 'microphone' ? 'Microphone' : 'System audio'} stopped recording.`).join(' ') : previous.recordingError,
    };
};

const applyFallbackDuration = (previous: RecordingSessionState): RecordingSessionState => {
    if (previous.recordingState !== 'recording') return previous;

    const now = Date.now();
    const hasRecentProgress = Boolean(previous.lastProgressAt && now - previous.lastProgressAt < 800);

    if (hasRecentProgress) return previous;

    const recordingStartAt = previous.recordingStartAt ?? now;
    const recordingDurationMs = Math.max(previous.recordingDurationMs, now - recordingStartAt);

    if (recordingDurationMs === previous.recordingDurationMs && recordingStartAt === previous.recordingStartAt) {
        return previous;
    }

    return { ...previous, recordingStartAt, recordingDurationMs };
};

export class RecordingSessionStore {
    private stateValue: RecordingSessionState = initialSessionState;

    private activeOperation: ForegroundOperation | null = null;

    private pendingStart: { operation: ForegroundOperation; idleReceived: boolean } | null = null;

    private unsubscribeFunctions: Array<() => void> = [];

    private durationTimer: ReturnType<typeof setInterval> | null = null;

    private initialized = false;

    private disposed = false;

    private lifecycleId = 0;

    transcribeWhenRecordingStops = false;

    private preferenceRevision = 0;

    private lastFinishedRecordingId: string | null = null;

    constructor(private readonly dependencies: RecordingSessionDependencies) {
        makeAutoObservable<
            this,
            'dependencies' | 'unsubscribeFunctions' | 'durationTimer' | 'lifecycleId'
        >(this, {
            dependencies: false,
            unsubscribeFunctions: false,
            durationTimer: false,
            lifecycleId: false,
        }, { autoBind: true });
    }

    get state(): Readonly<RecordingSessionState> {
        return this.stateValue;
    }

    initialize(): void {
        if (this.initialized) return;

        this.initialized = true;
        this.disposed = false;
        const lifecycleId = this.lifecycleId + 1;

        this.lifecycleId = lifecycleId;
        const api = this.dependencies.adapter;

        if (!api) return;

        const preferenceRevision = this.preferenceRevision;
        void api.getUiPreference('transcribeWhenRecordingStops').then((enabled) => {
            if (lifecycleId === this.lifecycleId && preferenceRevision === this.preferenceRevision) {
                runInAction(() => { this.transcribeWhenRecordingStops = enabled; });
            }
        }).catch((error: unknown) => console.error('Failed to load automatic transcription preference', error));

        // Protect an ongoing capture while its current state is being restored.
        this.handleRecordingState(this.stateValue.recordingState);

        void api.getRecordingState()
            .then((state) => {
                if (this.disposed || lifecycleId !== this.lifecycleId) return;

                runInAction(() => {
                    this.handleRecordingState(state);
                });
            })
            .catch((error: unknown) => {
                console.error('Failed to load recording state', error);
            });

        this.unsubscribeFunctions = [
            api.onRecordingState((state) => this.handleRecordingState(state)),
            api.onRecordingProgress((progress) => this.handleRecordingProgress(progress)),
            api.onRecordingLevel((level) => this.handleRecordingLevel(level)),
            api.onRecordingError((payload) => this.handleRecordingError(payload)),
            api.onRecordingFinished((result) => { void this.finishAutomaticRecording(result); }),
        ];
        this.durationTimer = globalThis.setInterval(() => this.updateFallbackDuration(), 200);
    }

    dispose(): void {
        if (!this.initialized) return;

        this.initialized = false;
        this.disposed = true;
        this.lifecycleId += 1;
        this.pendingStart = null;
        this.stateValue = { ...this.stateValue, isProcessingRecording: false };
        this.unsubscribeFunctions.forEach((unsubscribe) => unsubscribe());
        this.unsubscribeFunctions = [];

        if (this.activeOperation) {
            this.dependencies.operations.finish(this.activeOperation);
            this.activeOperation = null;
        }

        if (this.durationTimer !== null) {
            globalThis.clearInterval(this.durationTimer);
            this.durationTimer = null;
        }
    }

    async startRecording(): Promise<CommandResult> {
        const api = this.dependencies.adapter;

        if (!api) return commandFailure('Audio recording is not available.');
        const devices = this.dependencies.devicesStore.state;

        if (api.runtimePlatform === 'win32' && (devices.isLoading || (devices.systemDeviceId === null && devices.microphoneDeviceId === null))) {
            return commandFailure('Enable at least one recording source.');
        }

        const operation = this.dependencies.operations.begin('recording');

        if (!operation) return commandFailure('Another workspace operation is already running.');

        this.activeOperation = operation;
        this.pendingStart = { operation, idleReceived: false };
        this.stateValue = { ...clearSessionBeforeStart(this.stateValue), recordingSources: this.selectedSources() };

        try {
            const permissionStatus = await api.getRecordingPermissionStatus();
            const isRecordingAvailable = await api.isRecordingAvailable();

            if (!this.dependencies.operations.owns(operation) || this.disposed) {
                return commandFailure('Recording was cancelled.');
            }

            runInAction(() => {
                this.dependencies.availabilityStore.replaceState({ permissionStatus, isRecordingAvailable });
            });

            if (!isRecordingAvailable) {
                return this.failStart(operation, 'System audio recording is unavailable.');
            }

            if (permissionStatus === 'restricted') {
                return this.failStart(operation, 'Screen recording is restricted by system policy.');
            }

            if (permissionStatus === 'denied') {
                this.dependencies.logService.append(
                    'Screen recording permission is disabled for the app. Trying to request it via the helper.',
                );
            }

            const { selectedDeviceId } = this.dependencies.devicesStore.state;
            const result = await api.startSystemRecording({
                deviceId: selectedDeviceId || undefined,
                sources: api.runtimePlatform === 'win32' ? {
                    system: devices.systemDeviceId,
                    microphone: devices.microphoneDeviceId,
                } : undefined,
            });

            if (!this.dependencies.operations.owns(operation) || this.disposed) {
                return commandFailure('Recording was cancelled.');
            }

            if ('error' in result) {
                this.dependencies.onRecoveryChanged();
                return this.failStart(operation, RECORDING_STORAGE_FULL_MESSAGE, RECORDING_STORAGE_FULL_MESSAGE);
            }

            this.dependencies.logService.append('Recording started.');

            return commandSuccess(undefined);
        } catch (error: unknown) {
            const message = getErrorMessage(error);

            console.error('Failed to start recording', error);
            if (!this.dependencies.operations.owns(operation) || this.disposed) {
                return commandFailure('Recording was cancelled.');
            }
            this.dependencies.onRecoveryChanged();

            return this.failStart(operation, `Failed to start recording: ${message}`, 'Could not start recording. Check the selected devices.');
        } finally {
            runInAction(() => {
                if (this.pendingStart?.operation.id !== operation.id) return;
                const idleReceived = this.pendingStart.idleReceived;
                this.pendingStart = null;
                if (idleReceived && this.activeOperation?.id === operation.id) this.handleRecordingState('idle');
            });
        }
    }

    async stopRecording(): Promise<CommandResult<SessionDetails>> {
        return this.finishRecording();
    }

    async setTranscribeWhenRecordingStops(enabled: boolean): Promise<void> {
        this.preferenceRevision += 1;
        this.transcribeWhenRecordingStops = enabled;
        try {
            await this.dependencies.adapter?.setUiPreference('transcribeWhenRecordingStops', enabled);
        } catch (error: unknown) {
            this.dependencies.logService.append('Could not save the automatic transcription preference.');
            console.error('Failed to save automatic transcription preference', error);
        }
    }

    private async finishAutomaticRecording(result: FinalizeRecordingResult): Promise<void> {
        if (this.disposed || this.stateValue.isProcessingRecording || this.lastFinishedRecordingId === result.recordingId) return;
        if (!this.activeOperation) this.activeOperation = this.dependencies.operations.begin('recording');
        if (!this.activeOperation) return;

        await this.finishRecording(result);
    }

    private async finishRecording(completedResult?: FinalizeRecordingResult): Promise<CommandResult<SessionDetails>> {
        const api = this.dependencies.adapter;
        const operation = this.activeOperation;

        if (!api || !operation || !this.dependencies.operations.owns(operation)) {
            return commandFailure('No recording is running.');
        }

        if (this.stateValue.isProcessingRecording) return commandFailure('Recording is already being saved.');

        this.dependencies.operations.transition(operation, 'processing-recording');
        this.stateValue = { ...this.stateValue, isProcessingRecording: true };
        let captureStopped = false;
        let savedSession: SessionDetails | undefined;
        let transcribe = false;

        try {
            const result = completedResult ?? await api.stopSystemRecording();

            captureStopped = true;
            if (!this.dependencies.operations.owns(operation) || this.disposed) {
                return commandFailure('Recording was cancelled.');
            }
            this.dependencies.logService.append('Recording finished.');
            const session = await api.getSession(result.sessionId);

            if (!this.dependencies.operations.owns(operation) || this.disposed) {
                return commandFailure('The recorded session was replaced before it finished loading.');
            }

            savedSession = session;
            transcribe = this.transcribeWhenRecordingStops && !this.stateValue.recordingError && !result.sourceWarnings.length
                && !session.tracks?.some((track) => track.failure);
            runInAction(() => { this.lastFinishedRecordingId = result.recordingId; });
            this.dependencies.logService.append('Recording was saved as a session and loaded into the player.');

            return commandSuccess(session);
        } catch (error: unknown) {
            if (!this.dependencies.operations.owns(operation) || this.disposed) {
                return commandFailure('Recording was cancelled.');
            }
            const message = getErrorMessage(error);

            captureStopped ||= this.stateValue.recordingState === 'idle';

            console.error('Failed to stop recording', error);
            runInAction(() => {
                this.stateValue = { ...this.stateValue, recordingError: 'Failed to finish the recording.' };
            });
            this.dependencies.logService.append(`Failed to stop recording: ${message}`);
            this.dependencies.onRecoveryChanged();

            return commandFailure('Failed to finish the recording.');
        } finally {
            runInAction(() => {
                if (!this.dependencies.operations.owns(operation)) return;
                this.stateValue = { ...this.stateValue, isProcessingRecording: false };

                // Import failure must not retain the lock after capture has stopped.
                if (captureStopped) {
                    this.dependencies.operations.finish(operation);
                    this.activeOperation = null;
                    if (savedSession) this.dependencies.onSessionImported(savedSession, transcribe);
                } else {
                    this.dependencies.operations.transition(operation, 'recording');
                }
            });
        }
    }

    private failStart(
        operation: ForegroundOperation,
        logMessage: string,
        errorMessage = logMessage,
    ): CommandResult {
        this.stateValue = { ...this.stateValue, recordingError: errorMessage };
        this.dependencies.logService.append(logMessage);
        this.dependencies.operations.finish(operation);
        this.activeOperation = null;

        return commandFailure(errorMessage);
    }

    private selectedSources(): RecordingSourceKind[] {
        if (this.dependencies.adapter?.runtimePlatform !== 'win32') return ['system'];
        const { systemDeviceId, microphoneDeviceId, isLoading } = this.dependencies.devicesStore.state;
        if (isLoading) return [];
        return (['system', 'microphone'] as const).filter((source) => (source === 'system' ? systemDeviceId : microphoneDeviceId) !== null);
    }

    private handleRecordingState(state: RecordingState): void {
        if (this.pendingStart) this.pendingStart.idleReceived = state === 'idle';

        if (state !== 'idle' && !this.activeOperation && !this.dependencies.operations.isBusy) {
            this.activeOperation = this.dependencies.operations.begin('recording');
            this.stateValue = { ...this.stateValue, recordingSources: this.selectedSources() };
        }
        this.stateValue = applyRecordingState(this.stateValue, state);

        // Start replies carry actionable failures even when the service has already emitted idle.
        if (state === 'idle' && !this.pendingStart && !this.stateValue.isProcessingRecording && this.activeOperation) {
            this.dependencies.operations.finish(this.activeOperation);
            this.activeOperation = null;
        }
    }

    private handleRecordingProgress(progress: RecordingProgress): void {
        this.stateValue = applyRecordingProgress(this.stateValue, progress);
    }

    private handleRecordingLevel(level: RecordingLevel): void {
        const platform = this.dependencies.adapter?.runtimePlatform ?? null;
        const sourceLevels = level.source ? { ...this.stateValue.sourceLevels, [level.source]: level } : this.stateValue.sourceLevels;
        const levels = Object.values(sourceLevels);
        const combinedLevel = level.source ? {
            peak: Math.max(...levels.map((value) => value.peak)),
            rms: Math.max(...levels.map((value) => value.rms)),
            clipped: levels.some((value) => value.clipped),
        } : level;
        const recordingSources = level.source && !this.stateValue.recordingSources.includes(level.source) ?
            [...this.stateValue.recordingSources, level.source] : this.stateValue.recordingSources;
        const source = level.source ?? (platform === 'darwin' ? 'system' : undefined);
        const lastSourceSignalMs = { ...this.stateValue.lastSourceSignalMs };
        if (source && this.stateValue.recordingState === 'recording') {
            if (level.peak > silenceThreshold || level.rms > silenceThreshold || lastSourceSignalMs[source] === undefined) {
                lastSourceSignalMs[source] = this.stateValue.recordingDurationMs;
            }
        }
        this.stateValue = { ...this.stateValue, recordingLevel: combinedLevel, sourceLevels, recordingSources, lastSourceSignalMs };
    }

    private handleRecordingError(payload: { message: string }): void {
        this.stateValue = { ...this.stateValue, recordingError: 'Recording failed. Check the selected devices.' };
        this.dependencies.logService.append(`Recording error: ${payload.message}`);
    }

    private updateFallbackDuration(): void {
        this.stateValue = applyFallbackDuration(this.stateValue);
    }
}
