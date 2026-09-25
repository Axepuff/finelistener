import type { SessionDetails } from 'electron/src/types/sessions';
import type { UiPreferenceKey, UiPreferenceValueMap } from 'electron/src/types/uiPreferences';
import type { WhisperModelName } from 'electron/src/types/whisper';
import { configure, makeAutoObservable, runInAction } from 'mobx';
import { TranscriptionControlStore } from 'renderer/src/features/transcribe-control';
import { SystemAudioRecorderStore } from 'renderer/src/features/recorder/src/ui/SystemAudioRecorder/core/recordingStore';
import {
    evaluateTranscriptionWorkflow,
    type TranscriptionLifecycleState,
    type TranscriptionWorkflowSnapshot,
} from 'renderer/src/features/transcribe-state/src/model/transcriptionWorkflow';
import { ActivityLogStore } from './activityLogStore';
import { ForegroundOperationStore } from './foregroundOperationStore';
import type { RendererAdapter } from './rendererAdapter';
import { SessionsStore } from './sessionsStore';
import { TranscriptionStore, type StartTranscriptionOptions, type TranscriptionRunRequest } from './transcriptionStore';
import {
    commandFailure,
    commandSuccess,
    type AudioMode,
    type CommandResult,
} from './types';
import { WhisperModelStore } from './whisperModelStore';
import { WorkspaceStore } from './workspaceStore';
import { RecordingRecoveryStore } from './recordingRecoveryStore';

configure({ enforceActions: 'always' });

export class AppStore {
    readonly activityLog = new ActivityLogStore();

    readonly operations = new ForegroundOperationStore();

    readonly workspace = new WorkspaceStore();

    readonly sessions: SessionsStore;

    readonly transcription: TranscriptionStore;

    readonly transcriptionControl = new TranscriptionControlStore();

    readonly whisperModels: WhisperModelStore;

    readonly recording: SystemAudioRecorderStore;

    readonly recordingRecovery: RecordingRecoveryStore;

    private unsubscribeFunctions: Array<() => void> = [];

    private initialized = false;

    private disposed = false;

    private transcriptionRequestId = 0;

    constructor(private readonly adapter: RendererAdapter | null) {
        this.sessions = new SessionsStore(adapter);
        this.transcription = new TranscriptionStore(adapter);
        this.whisperModels = new WhisperModelStore(adapter);
        this.recording = new SystemAudioRecorderStore({
            adapter,
            activityLog: this.activityLog,
            operations: this.operations,
            onSessionImported: (session) => this.acceptSession(session),
            onRecoveryChanged: () => { void this.recordingRecovery.refresh(); },
        });
        this.recordingRecovery = new RecordingRecoveryStore(adapter, this.operations, (session) => this.acceptSession(session));
        makeAutoObservable<this, 'adapter' | 'unsubscribeFunctions' | 'transcriptionRequestId'>(this, {
            adapter: false,
            activityLog: false,
            operations: false,
            workspace: false,
            sessions: false,
            transcription: false,
            transcriptionControl: false,
            transcriptionRequestId: false,
            whisperModels: false,
            recording: false,
            recordingRecovery: false,
            unsubscribeFunctions: false,
        }, { autoBind: true });
    }

    get isElectron(): boolean {
        return this.adapter !== null;
    }

    get runtimePlatform(): RendererAdapter['runtimePlatform'] | null {
        return this.adapter?.runtimePlatform ?? null;
    }

    get lifecycleState(): TranscriptionLifecycleState {
        if (this.operations.kind === 'importing' || this.operations.kind === 'opening-session') return 'importing';
        if (this.operations.kind === 'transcribing') return 'transcribing';

        return this.workspace.hasAudioSource ? 'ready' : 'initial';
    }

    get transcriptionWorkflow(): TranscriptionWorkflowSnapshot {
        return evaluateTranscriptionWorkflow({
            lifecycleState: this.lifecycleState,
            hasAudioSource: this.workspace.hasAudioSource,
            hasRenderedOutput: this.transcription.hasVisibleTranscript,
            runOutcome: this.transcription.runOutcome,
        });
    }

    initialize(): void {
        if (this.initialized) return;

        this.initialized = true;
        this.disposed = false;
        this.sessions.initialize();
        this.transcription.initialize();

        if (this.adapter) {
            this.unsubscribeFunctions = [
                this.adapter.onTranscribeLog((line) => this.activityLog.appendProcessOutput(line)),
                this.adapter.onWhisperModelDownloadProgress((progress) => {
                    this.whisperModels.updateDownloadProgress(progress);
                }),
            ];
            void this.whisperModels.refresh();
        }

        this.recording.initialize();
        this.recordingRecovery.initialize();
    }

    dispose(): void {
        if (!this.initialized) return;

        this.initialized = false;
        this.disposed = true;
        this.transcriptionRequestId += 1;
        this.transcriptionControl.dispose();
        this.unsubscribeFunctions.forEach((unsubscribe) => unsubscribe());
        this.unsubscribeFunctions = [];
        this.transcription.dispose();
        this.recording.dispose();
        this.recordingRecovery.dispose();
        this.sessions.dispose();
        this.operations.cancelActive();
    }

    async importAudio(): Promise<CommandResult<SessionDetails | null>> {
        if (!this.adapter) return commandFailure('Audio import is not available.');

        const operation = this.operations.begin('importing');

        if (!operation) return commandFailure('Another workspace operation is already running.');

        try {
            const session = await this.adapter.importAudio();

            if (!this.operations.owns(operation) || this.disposed) {
                return commandFailure('Audio import was cancelled.');
            }

            if (session) {
                runInAction(() => {
                    this.acceptSession(session);
                });
            }

            return commandSuccess(session);
        } catch (error: unknown) {
            console.error('Failed to import audio into a session', error);

            return commandFailure('Failed to import the audio file.');
        } finally {
            runInAction(() => {
                this.operations.finish(operation);
            });
        }
    }

    async openSession(sessionId: string): Promise<CommandResult<SessionDetails>> {
        if (!this.adapter) return commandFailure('Sessions are not available.');

        const operation = this.operations.begin('opening-session');

        if (!operation) return commandFailure('Another workspace operation is already running.');

        try {
            const session = await this.adapter.getSession(sessionId);

            if (!this.operations.owns(operation) || this.disposed) {
                return commandFailure('The session was replaced before it finished loading.');
            }

            runInAction(() => {
                this.acceptSession(session);
            });

            return commandSuccess(session);
        } catch (error: unknown) {
            console.error('Failed to open session', error);

            return commandFailure('Failed to open the session.');
        } finally {
            runInAction(() => {
                this.operations.finish(operation);
            });
        }
    }

    async deleteSession(sessionId: string): Promise<CommandResult> {
        if (!this.adapter) return commandFailure('Sessions are not available.');
        const operation = this.operations.begin('deleting-session');

        if (!operation) return commandFailure('Another workspace operation is already running.');

        try {
            await this.adapter.deleteSession(sessionId);

            if (!this.operations.owns(operation) || this.disposed) {
                return commandFailure('Session deletion is no longer active.');
            }

            if (this.workspace.activeSessionId === sessionId) {
                await this.adapter.setActiveSession(null);

                if (!this.operations.owns(operation) || this.disposed) {
                    return commandFailure('Session deletion is no longer active.');
                }
            }

            runInAction(() => {
                this.sessions.remove(sessionId);

                if (this.workspace.activeSessionId === sessionId) {
                    this.transcriptionControl.cancelPendingDownload();
                    this.workspace.clearWorkspace();
                    this.transcription.clear();
                }
            });
            void this.sessions.refresh();

            return commandSuccess(undefined);
        } catch (error: unknown) {
            console.error('Failed to delete session', error);

            return commandFailure('Failed to delete the session.');
        } finally {
            runInAction(() => {
                this.operations.finish(operation);
            });
        }
    }

    async setAudioMode(mode: AudioMode): Promise<CommandResult> {
        if (this.operations.isBusy) return commandFailure('Another workspace operation is already running.');

        if (mode === 'original') {
            this.workspace.useOriginalAudio();

            return commandSuccess(undefined);
        }

        const session = this.workspace.activeSession;

        if (!session || !this.adapter) return commandFailure('No session is open.');

        if (session.audioOptimizedWavPath) {
            this.workspace.useOptimizedAudio(session);

            return commandSuccess(undefined);
        }

        const operation = this.operations.begin('optimizing-audio');

        if (!operation) return commandFailure('Another workspace operation is already running.');

        try {
            const updatedSession = await this.adapter.optimizeAudio(session.id);

            if (!this.operations.owns(operation) || this.workspace.activeSessionId !== session.id || this.disposed) {
                return commandFailure('Audio optimization was replaced before it finished.');
            }

            if (!updatedSession.audioOptimizedWavPath) {
                console.error('Optimization completed but no optimized path was returned');

                return commandFailure('The optimized audio could not be loaded.');
            }

            runInAction(() => {
                this.workspace.useOptimizedAudio(updatedSession);
            });

            return commandSuccess(undefined);
        } catch (error: unknown) {
            console.error('Failed to optimize audio', error);

            return commandFailure('Failed to optimize the audio.');
        } finally {
            runInAction(() => {
                this.operations.finish(operation);
            });
        }
    }

    async requestTranscriptionStart(): Promise<CommandResult> {
        if (this.disposed) return commandFailure('Transcription is not available.');
        if (this.operations.isBusy) return commandFailure('Another workspace operation is already running.');

        const control = this.transcriptionControl;
        const preparation = control.requestStart(this.whisperModels.isDownloaded(control.model));

        if (preparation.status === 'failed') return commandFailure(preparation.message);
        if (preparation.status === 'awaiting-download') return commandSuccess(undefined);

        return this.startPreparedTranscription(preparation.options);
    }

    async confirmPendingTranscriptionDownload(): Promise<CommandResult> {
        if (this.disposed) return commandFailure('Model download is not available.');
        if (this.whisperModels.isDownloadActive) return commandFailure('Model download is already in progress.');

        const intent = this.transcriptionControl.beginPendingDownload();

        if (!intent) return commandFailure('No model download is pending.');

        const result = await this.whisperModels.download(intent.model);
        const preparation = this.transcriptionControl.completePendingDownload(intent, result);

        if (!preparation) return commandSuccess(undefined);
        if (preparation.status === 'failed') return commandFailure(preparation.message);
        if (preparation.status === 'awaiting-download') return commandSuccess(undefined);

        return this.startPreparedTranscription(preparation.options);
    }

    async downloadWhisperModel(model: WhisperModelName): Promise<CommandResult> {
        if (this.disposed) return commandFailure('Model download is not available.');
        if (this.whisperModels.isDownloadActive) return commandFailure('Model download is already in progress.');

        return this.whisperModels.download(model);
    }

    private async startPreparedTranscription(options: StartTranscriptionOptions, retryFailed = false): Promise<CommandResult> {
        const requestId = ++this.transcriptionRequestId;
        const result = await this.startTranscription(options, retryFailed);

        // An intentional stop or reset supersedes the original button request's result.
        return requestId === this.transcriptionRequestId && !this.disposed ? result : commandSuccess(undefined);
    }

    async retryIncompleteTranscription(): Promise<CommandResult> {
        const run = this.transcription.savedTranscript?.sourceRun;

        if (!run || run.status !== 'incomplete') return commandFailure('No incomplete transcription is available.');

        return this.startPreparedTranscription({
            language: run.settings.language,
            model: run.settings.model ?? 'base',
            modelPath: run.settings.modelPath,
            maxContext: run.settings.maxContext,
            maxLen: run.settings.maxLen,
            splitOnWord: run.settings.splitOnWord ?? false,
            useVad: run.settings.useVad ?? false,
            microphoneGateEnabled: run.settings.microphoneGateEnabled ?? false,
        }, true);
    }

    async startTranscription(options: StartTranscriptionOptions, retryFailed = false): Promise<CommandResult> {
        const audioPath = this.workspace.audioSourcePath;

        if (!this.adapter) return commandFailure('Transcription is not available.');
        if (!audioPath) return commandFailure('Choose an audio source before transcribing.');
        if (!retryFailed && this.workspace.hasIncompleteSegment) {
            return commandFailure('Set both the start and end of the segment, with the end after the start.');
        }

        const operation = this.operations.begin('transcribing');

        if (!operation) return commandFailure('Another workspace operation is already running.');

        const selectedSegment = retryFailed ?
            this.transcription.savedTranscript?.sourceRun?.settings.segment :
            this.workspace.selectedSegment ?? undefined;
        const sessionId = this.workspace.activeSessionId ?? undefined;
        const fileName = audioPath.split(/[/\\]/).pop() || audioPath;

        if (selectedSegment) {
            this.activityLog.appendEvent(
                `Transcribing segment ${selectedSegment.start.toFixed(2)} s — ${selectedSegment.end.toFixed(2)} s of ${fileName}`,
            );
        } else {
            this.activityLog.appendEvent(`Starting Whisper transcription for ${fileName}`);
        }

        const request: TranscriptionRunRequest = {
            audioPath,
            sessionId,
            segment: selectedSegment ? { ...selectedSegment } : undefined,
            options: { ...options },
            sourceAware: Boolean(this.workspace.activeSession?.tracks?.length),
            retryFailed,
            optimized: this.workspace.audioMode === 'optimized',
            hideDuplicateSpeech: this.transcription.preferredDuplicateFilterEnabled,
        };
        const startedAt = performance.now();
        const isCurrent = (): boolean => this.operations.owns(operation) && !this.disposed;

        try {
            const result = await this.transcription.start(request, isCurrent);

            if (result.status === 'replaced' || !isCurrent()) {
                return commandFailure('The transcription run is no longer active.');
            }
            if (result.status === 'failed') {
                this.activityLog.appendEvent(`Whisper transcription failed for ${fileName}`);
                void this.sessions.refresh();

                return commandFailure(result.message);
            }

            const durationSeconds = Math.max(0, performance.now() - startedAt) / 1000;

            this.activityLog.appendEvent(result.status === 'incomplete' ?
                `Whisper transcription is incomplete for ${fileName}` :
                `Whisper transcription finished for ${fileName}`);
            this.activityLog.appendEvent(`Processed ${fileName}: ${durationSeconds.toFixed(1)} s.`);
            void this.sessions.refresh();

            return commandSuccess(undefined);
        } finally {
            runInAction(() => {
                this.operations.finish(operation);
            });
        }
    }

    async stopTranscription(): Promise<CommandResult> {
        if (!this.adapter || this.operations.kind !== 'transcribing') {
            return commandFailure('No transcription is running.');
        }

        const operation = this.operations.active;

        if (!operation) return commandFailure('No transcription is running.');

        this.transcriptionRequestId += 1;
        const isCurrent = (): boolean => this.operations.owns(operation) && !this.disposed;
        const result = await this.transcription.stop(isCurrent);

        if (!isCurrent()) {
            return commandFailure('The transcription run is no longer active.');
        }
        if (!result.ok) return result;

        runInAction(() => {
            this.operations.finish(operation);
        });
        this.activityLog.appendEvent('Transcription stopped.');

        return commandSuccess(undefined);
    }

    clearWorkspace(): CommandResult {
        if (this.operations.isBusy) return commandFailure('Another workspace operation is already running.');

        this.transcriptionRequestId += 1;
        this.transcriptionControl.cancelPendingDownload();
        void this.adapter?.setActiveSession(null).catch((error: unknown) => {
            console.error('Failed to clear the active session', error);
        });
        this.workspace.clearWorkspace();
        this.transcription.clear();

        return commandSuccess(undefined);
    }

    async revealSessionsFolder(): Promise<CommandResult> {
        if (!this.adapter) return commandFailure('Sessions are not available.');

        try {
            await this.adapter.revealSessionsFolder();

            return commandSuccess(undefined);
        } catch (error: unknown) {
            console.error('Failed to reveal sessions folder', error);

            return commandFailure('Failed to open the sessions folder.');
        }
    }

    async saveText(content: string): Promise<CommandResult> {
        if (!this.adapter) return commandFailure('Saving text is not available.');

        try {
            const result = await this.adapter.saveText(content);

            return result.ok ? commandSuccess(undefined) : commandFailure('Failed to save the transcript.');
        } catch (error: unknown) {
            console.error('Failed to save transcript text', error);

            return commandFailure('Failed to save the transcript.');
        }
    }

    async setTranscriptDuplicateFilterEnabled(enabled: boolean): Promise<CommandResult> {
        const sessionId = this.workspace.activeSessionId;

        if (!this.adapter || !sessionId || !this.transcription.duplicateFilterAvailable) {
            return commandFailure('Duplicate filtering is not available for this transcript.');
        }
        const operation = this.operations.begin('filtering-transcript');

        if (!operation) return commandFailure('Another workspace operation is already running.');

        try {
            const session = await this.adapter.setTranscriptDuplicateFilter(sessionId, enabled);

            if (!this.operations.owns(operation) || this.disposed || this.workspace.activeSessionId !== sessionId) {
                return commandFailure('The session was replaced before duplicate filtering finished.');
            }

            runInAction(() => {
                this.transcription.replaceSavedTranscript(session.transcript ?? null);
                this.transcription.setDuplicateFilterPreference(enabled);
            });
            void this.adapter.setUiPreference('transcriptDuplicateFilterEnabled', enabled).catch((error: unknown) => {
                console.error('Failed to save transcript duplicate filter preference', error);
                this.activityLog.appendEvent('The duplicate filter preference could not be saved.');
            });
            void this.sessions.refresh();

            return commandSuccess(undefined);
        } catch (error: unknown) {
            console.error('Failed to update transcript duplicate filtering', error);

            return commandFailure('Duplicate filtering could not be updated.');
        } finally {
            runInAction(() => {
                this.operations.finish(operation);
            });
        }
    }

    async openDevTools(): Promise<void> {
        try {
            await this.adapter?.openDevTools();
        } catch (error: unknown) {
            console.error('Failed to open devtools', error);
        }
    }

    getUiPreference<K extends UiPreferenceKey>(key: K): Promise<UiPreferenceValueMap[K] | null> {
        return this.adapter?.getUiPreference(key) ?? Promise.resolve(null);
    }

    async setUiPreference<K extends UiPreferenceKey>(key: K, value: UiPreferenceValueMap[K]): Promise<void> {
        await this.adapter?.setUiPreference(key, value);
    }

    private acceptSession(session: SessionDetails): void {
        void this.adapter?.setActiveSession(session.id).catch((error: unknown) => {
            console.error('Failed to update the active session', error);
        });
        this.workspace.replaceWorkspace(session);
        this.transcription.replaceSavedTranscript(session.transcript ?? null);
        void this.sessions.refresh();
    }

}
