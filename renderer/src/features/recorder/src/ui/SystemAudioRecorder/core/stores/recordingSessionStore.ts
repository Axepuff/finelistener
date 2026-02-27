import type {
    RecordingLevel,
    RecordingProgress,
    RecordingState,
} from 'electron/src/services/RecordingService';
import { atom, type PrimitiveAtom } from 'jotai';
import { atoms } from 'renderer/src/atoms';
import { getErrorMessage } from '../recordingUtils';
import type { RecordingLogService } from './recordingLogService';
import {
    type RecordingAvailabilityState,
    type RecordingDependencies,
    type RecordingDevicesState,
    type RecordingSessionState,
    initialSessionState,
} from './recordingStoreTypes';

const SILENCE_PEAK_THRESHOLD = 0.0005;
const SILENCE_RMS_THRESHOLD = 0.0005;
const SILENCE_WARNING_AFTER_MS = 2000;

interface RecordingSessionDependencies extends RecordingDependencies {
    logService: RecordingLogService;
    availabilityAtom: PrimitiveAtom<RecordingAvailabilityState>;
    devicesAtom: PrimitiveAtom<RecordingDevicesState>;
}

interface LevelProcessingResult {
    nextState: RecordingSessionState;
    logMessage: string | null;
}

const clearSessionBeforeStart = (prev: RecordingSessionState): RecordingSessionState => {
    return {
        ...prev,
        recordingError: null,
        recordingLevel: null,
        showSilenceWarning: false,
        recordingDurationMs: 0,
        recordingBytesWritten: null,
        recordingStartAt: null,
        lastProgressAt: null,
        silenceStartedAt: null,
        silenceLogged: false,
    };
};

const applyRecordingState = (prev: RecordingSessionState, state: RecordingState): RecordingSessionState => {
    const next: RecordingSessionState = {
        ...prev,
        recordingState: state,
    };

    if (state === 'recording' && !prev.recordingStartAt) {
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
    prev: RecordingSessionState,
    progress: RecordingProgress,
): RecordingSessionState => {
    return {
        ...prev,
        recordingDurationMs: progress.durationMs,
        recordingBytesWritten: typeof progress.bytesWritten === 'number' ? progress.bytesWritten : null,
        lastProgressAt: Date.now(),
    };
};

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
    prev: RecordingSessionState,
    level: RecordingLevel,
    platform: string | null,
): LevelProcessingResult => {
    const now = Date.now();
    const isSilent = level.peak <= SILENCE_PEAK_THRESHOLD && level.rms <= SILENCE_RMS_THRESHOLD;
    let silenceStartedAt = prev.silenceStartedAt;
    let silenceLogged = prev.silenceLogged;
    let showSilenceWarning = prev.showSilenceWarning;
    let logMessage: string | null = null;

    if (!isSilent) {
        silenceStartedAt = null;
        silenceLogged = false;
        showSilenceWarning = false;
    } else {
        if (!silenceStartedAt) {
            silenceStartedAt = now;
        } else if (now - silenceStartedAt >= SILENCE_WARNING_AFTER_MS) {
            showSilenceWarning = true;

            if (!silenceLogged) {
                silenceLogged = true;
                logMessage = getSilenceWarningMessage(platform);
            }
        }
    }

    return {
        nextState: {
            ...prev,
            recordingLevel: level,
            showSilenceWarning,
            silenceStartedAt,
            silenceLogged,
        },
        logMessage,
    };
};

const applyFallbackDuration = (prev: RecordingSessionState): RecordingSessionState => {
    if (prev.recordingState !== 'recording') {
        return prev;
    }

    const now = Date.now();
    const hasRecentProgress = Boolean(prev.lastProgressAt && now - prev.lastProgressAt < 800);

    if (hasRecentProgress) {
        return prev;
    }

    const recordingStartAt = prev.recordingStartAt ?? now;
    const recordingDurationMs = now - recordingStartAt;
    const isDurationFresh = recordingDurationMs === prev.recordingDurationMs
        && recordingStartAt === prev.recordingStartAt;

    if (isDurationFresh) {
        return prev;
    }

    return {
        ...prev,
        recordingStartAt,
        recordingDurationMs,
    };
};

export class RecordingSessionStore {
    // Represents active recording session state and derived live metrics.
    readonly sessionAtom = atom<RecordingSessionState>(initialSessionState);

    readonly startRecordingAtom = atom(null, async (get, set) => {
        const api = this.dependencies.getApi();

        if (!api) {
            return;
        }

        set(this.sessionAtom, clearSessionBeforeStart);

        try {
            const permissionStatus = await api.getRecordingPermissionStatus();
            const isRecordingAvailable = await api.isRecordingAvailable();

            const availabilityState: RecordingAvailabilityState = {
                permissionStatus,
                isRecordingAvailable,
            };

            set(this.dependencies.availabilityAtom, (prev) => ({
                ...prev,
                ...availabilityState,
            }));

            if (!availabilityState.isRecordingAvailable) {
                const message = 'System audio recording is unavailable (helper not found).';

                set(this.sessionAtom, (prev) => ({
                    ...prev,
                    recordingError: message,
                }));
                this.dependencies.logService.append(message);

                return;
            }

            if (availabilityState.permissionStatus === 'restricted') {
                const message = 'Screen recording is restricted by system policy.';

                set(this.sessionAtom, (prev) => ({
                    ...prev,
                    recordingError: message,
                }));
                this.dependencies.logService.append(message);

                return;
            }

            if (availabilityState.permissionStatus === 'denied') {
                this.dependencies.logService.append(
                    'Screen recording permission is disabled for the app. Trying to request it via the helper.',
                );
            }

            const { selectedDeviceId } = get(this.dependencies.devicesAtom);
            const session = await api.startSystemRecording({
                deviceId: selectedDeviceId || undefined,
            });

            this.dependencies.logService.append(`Recording started: ${session.filePath}`);
        } catch (error: unknown) {
            const message = getErrorMessage(error);

            set(this.sessionAtom, (prev) => ({
                ...prev,
                recordingError: message,
            }));
            this.dependencies.logService.append(`Failed to start recording: ${message}`);
        }
    });

    readonly stopRecordingAtom = atom(null, async (_get, set) => {
        const api = this.dependencies.getApi();

        if (!api) {
            return;
        }

        set(this.sessionAtom, (prev) => ({
            ...prev,
            isProcessingRecording: true,
        }));

        try {
            const result = await api.stopSystemRecording();

            this.dependencies.logService.append(`Recording finished: ${result.filePath}`);

            const { path } = await api.convertAudio({
                audioPath: result.filePath,
                lowPass: 12000,
                highPass: 80,
                dynanorm: true,
            });

            set(atoms.transcription.audioToTranscribe, [path]);
            set(atoms.transcription.runOutcome, 'none');
            set(atoms.transcription.runErrorMessage, null);
            this.dependencies.logService.append('Audio prepared and loaded into the player.');
        } catch (error: unknown) {
            const message = getErrorMessage(error);

            set(this.sessionAtom, (prev) => ({
                ...prev,
                recordingError: message,
            }));
            this.dependencies.logService.append(`Failed to stop recording: ${message}`);
        } finally {
            set(this.sessionAtom, (prev) => ({
                ...prev,
                isProcessingRecording: false,
            }));
        }
    });

    constructor(private readonly dependencies: RecordingSessionDependencies) {
        this.sessionAtom.onMount = (setSelf) => {
            const api = this.dependencies.getApi();

            if (!api) {
                return undefined;
            }

            const platform = api.runtime?.platform ?? null;

            const updateSession = (updater: (prev: RecordingSessionState) => RecordingSessionState) => {
                setSelf((prev) => updater(prev));
            };

            void api.getRecordingState()
                .then((state) => {
                    updateSession((prev) => applyRecordingState(prev, state));
                })
                .catch(() => {
                    updateSession((prev) => ({
                        ...prev,
                        recordingState: 'idle',
                    }));
                });

            const offState = api.onRecordingState?.((state) => {
                updateSession((prev) => applyRecordingState(prev, state));
            });

            const offProgress = api.onRecordingProgress?.((progress) => {
                updateSession((prev) => applyRecordingProgress(prev, progress));
            });

            const offLevel = api.onRecordingLevel?.((level) => {
                updateSession((prev) => {
                    const { nextState, logMessage } = applyRecordingLevel(prev, level, platform);

                    if (logMessage) {
                        this.dependencies.logService.append(logMessage);
                    }

                    return nextState;
                });
            });

            const offError = api.onRecordingError?.((payload) => {
                updateSession((prev) => ({
                    ...prev,
                    recordingError: payload.message,
                }));

                this.dependencies.logService.append(`Recording error: ${payload.message}`);
            });

            const timer = window.setInterval(() => {
                updateSession((prev) => applyFallbackDuration(prev));
            }, 200);

            return () => {
                offState?.();
                offProgress?.();
                offLevel?.();
                offError?.();
                window.clearInterval(timer);
            };
        };
    }
}
