import type {
    RecordingLevel,
    RecordingProgress,
    RecordingState,
} from 'electron/src/services/RecordingService';
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

const SILENCE_PEAK_THRESHOLD = 0.0005;
const SILENCE_RMS_THRESHOLD = 0.0005;
const SILENCE_WARNING_AFTER_MS = 2000;

interface RecordingSessionDependencies extends RecordingDependencies {
    logService: RecordingLogService;
    availabilityStore: RecordingAvailabilityStore;
    devicesStore: RecordingDevicesStore;
    operations: ForegroundOperationStore;
    onSessionImported: (session: SessionDetails) => void;
}

interface LevelProcessingResult {
    nextState: RecordingSessionState;
    logMessage: string | null;
}

const clearSessionBeforeStart = (previous: RecordingSessionState): RecordingSessionState => ({
    ...previous,
    recordingError: null,
    recordingLevel: null,
    showSilenceWarning: false,
    recordingDurationMs: 0,
    recordingBytesWritten: null,
    recordingStartAt: null,
    lastProgressAt: null,
    silenceStartedAt: null,
    silenceLogged: false,
});

const applyRecordingState = (previous: RecordingSessionState, state: RecordingState): RecordingSessionState => {
    const next: RecordingSessionState = { ...previous, recordingState: state };

    if (state === 'recording' && !previous.recordingStartAt) {
        next.recordingStartAt = Date.now();
    }

    if (state !== 'recording') {
        next.recordingStartAt = null;
        next.lastProgressAt = null;
        next.showSilenceWarning = false;
        next.silenceStartedAt = null;
        next.silenceLogged = false;
    }

    return next;
};

const applyRecordingProgress = (
    previous: RecordingSessionState,
    progress: RecordingProgress,
): RecordingSessionState => ({
    ...previous,
    recordingDurationMs: progress.durationMs,
    recordingBytesWritten: typeof progress.bytesWritten === 'number' ? progress.bytesWritten : null,
    lastProgressAt: Date.now(),
});

const getSilenceWarningMessage = (platform: string | null): string => {
    if (platform === 'darwin') {
        return 'No system audio detected. On macOS you may need to grant \'System Audio Recording\' permission in System Settings'
            + ' > Privacy & Security > Screen & System Audio Recording (System Audio Recording Only). In dev mode (`npm run dev`),'
            + ' the entry may show up as \'FineListener Dev\' or \'Electron\'. If you\'re running from an IDE terminal, add'
            + ' that terminal app there as well.';
    }

    return 'No system audio detected. Check that audio is playing and the correct output device is selected.';
};

const applyRecordingLevel = (
    previous: RecordingSessionState,
    level: RecordingLevel,
    platform: string | null,
): LevelProcessingResult => {
    const now = Date.now();
    const isSilent = level.peak <= SILENCE_PEAK_THRESHOLD && level.rms <= SILENCE_RMS_THRESHOLD;
    let silenceStartedAt = previous.silenceStartedAt;
    let silenceLogged = previous.silenceLogged;
    let showSilenceWarning = previous.showSilenceWarning;
    let logMessage: string | null = null;

    if (!isSilent) {
        silenceStartedAt = null;
        silenceLogged = false;
        showSilenceWarning = false;
    } else if (!silenceStartedAt) {
        silenceStartedAt = now;
    } else if (now - silenceStartedAt >= SILENCE_WARNING_AFTER_MS) {
        showSilenceWarning = true;

        if (!silenceLogged) {
            silenceLogged = true;
            logMessage = getSilenceWarningMessage(platform);
        }
    }

    return {
        nextState: {
            ...previous,
            recordingLevel: level,
            showSilenceWarning,
            silenceStartedAt,
            silenceLogged,
        },
        logMessage,
    };
};

const applyFallbackDuration = (previous: RecordingSessionState): RecordingSessionState => {
    if (previous.recordingState !== 'recording') return previous;

    const now = Date.now();
    const hasRecentProgress = Boolean(previous.lastProgressAt && now - previous.lastProgressAt < 800);

    if (hasRecentProgress) return previous;

    const recordingStartAt = previous.recordingStartAt ?? now;
    const recordingDurationMs = now - recordingStartAt;

    if (recordingDurationMs === previous.recordingDurationMs && recordingStartAt === previous.recordingStartAt) {
        return previous;
    }

    return { ...previous, recordingStartAt, recordingDurationMs };
};

export class RecordingSessionStore {
    private stateValue: RecordingSessionState = initialSessionState;

    private activeOperation: ForegroundOperation | null = null;

    private unsubscribeFunctions: Array<() => void> = [];

    private durationTimer: ReturnType<typeof setInterval> | null = null;

    private initialized = false;

    private disposed = false;

    private lifecycleId = 0;

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
        ];
        this.durationTimer = globalThis.setInterval(() => this.updateFallbackDuration(), 200);
    }

    dispose(): void {
        if (!this.initialized) return;

        this.initialized = false;
        this.disposed = true;
        this.lifecycleId += 1;
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

        if (!api) return commandFailure('System audio recording is not available.');

        const operation = this.dependencies.operations.begin('recording');

        if (!operation) return commandFailure('Another workspace operation is already running.');

        this.activeOperation = operation;
        this.stateValue = clearSessionBeforeStart(this.stateValue);

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
            const session = await api.startSystemRecording({
                deviceId: selectedDeviceId || undefined,
            });

            if (!this.dependencies.operations.owns(operation) || this.disposed) {
                return commandFailure('Recording was cancelled.');
            }

            this.dependencies.logService.append(`Recording started: ${session.filePath}`);

            return commandSuccess(undefined);
        } catch (error: unknown) {
            const message = getErrorMessage(error);

            return this.failStart(operation, `Failed to start recording: ${message}`, message);
        }
    }

    async stopRecording(): Promise<CommandResult<SessionDetails>> {
        const api = this.dependencies.adapter;
        const operation = this.activeOperation;

        if (!api || !operation || !this.dependencies.operations.owns(operation)) {
            return commandFailure('No recording is running.');
        }

        this.dependencies.operations.transition(operation, 'processing-recording');
        this.stateValue = { ...this.stateValue, isProcessingRecording: true };
        let captureStopped = false;

        try {
            const result = await api.stopSystemRecording();

            captureStopped = true;
            this.dependencies.logService.append(`Recording finished: ${result.filePath}`);
            const session = await api.importRecording(result.filePath);

            if (!this.dependencies.operations.owns(operation) || this.disposed) {
                return commandFailure('The recorded session was replaced before it finished loading.');
            }

            runInAction(() => {
                this.dependencies.onSessionImported(session);
            });
            this.dependencies.logService.append('Recording was saved as a session and loaded into the player.');

            return commandSuccess(session);
        } catch (error: unknown) {
            const message = getErrorMessage(error);

            console.error('Failed to stop recording', error);
            runInAction(() => {
                this.stateValue = { ...this.stateValue, recordingError: message };
            });
            this.dependencies.logService.append(`Failed to stop recording: ${message}`);

            return commandFailure('Failed to finish the recording.');
        } finally {
            runInAction(() => {
                this.stateValue = { ...this.stateValue, isProcessingRecording: false };

                // Import failure must not retain the lock after capture has stopped.
                if (captureStopped) {
                    this.dependencies.operations.finish(operation);
                    this.activeOperation = null;
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

    private handleRecordingState(state: RecordingState): void {
        this.stateValue = applyRecordingState(this.stateValue, state);

        if (state !== 'idle' && !this.activeOperation && !this.dependencies.operations.isBusy) {
            this.activeOperation = this.dependencies.operations.begin('recording');
        }

        if (state === 'idle' && !this.stateValue.isProcessingRecording && this.activeOperation) {
            this.dependencies.operations.finish(this.activeOperation);
            this.activeOperation = null;
        }
    }

    private handleRecordingProgress(progress: RecordingProgress): void {
        this.stateValue = applyRecordingProgress(this.stateValue, progress);
    }

    private handleRecordingLevel(level: RecordingLevel): void {
        const platform = this.dependencies.adapter?.runtimePlatform ?? null;
        const { nextState, logMessage } = applyRecordingLevel(this.stateValue, level, platform);

        this.stateValue = nextState;

        if (logMessage) {
            this.dependencies.logService.append(logMessage);
        }
    }

    private handleRecordingError(payload: { message: string }): void {
        this.stateValue = { ...this.stateValue, recordingError: payload.message };
        this.dependencies.logService.append(`Recording error: ${payload.message}`);
    }

    private updateFallbackDuration(): void {
        this.stateValue = applyFallbackDuration(this.stateValue);
    }
}
