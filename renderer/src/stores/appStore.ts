import type { SessionDetails } from 'electron/src/types/sessions';
import type { TranscribeOpts, TranscriptionTextEvent, TranscriptionProgressEvent } from 'electron/src/types/transcription';
import type { UiPreferenceKey, UiPreferenceValueMap } from 'electron/src/types/uiPreferences';
import type { WhisperModelName } from 'electron/src/types/whisper';
import { configure, makeAutoObservable, runInAction } from 'mobx';
import { SystemAudioRecorderStore } from 'renderer/src/features/recorder/src/ui/SystemAudioRecorder/core/recordingStore';
import {
    evaluateTranscriptionWorkflow,
    type TranscriptionLifecycleState,
    type TranscriptionWorkflowSnapshot,
} from 'renderer/src/features/transcribe-state/src/model/transcriptionWorkflow';
import { ActivityLogStore } from './activityLogStore';
import { ForegroundOperationStore } from './foregroundOperationStore';
import type { RendererAdapter } from './rendererAdapter';
import { TranscriptionStore } from './transcriptionStore';
import {
    commandFailure,
    commandSuccess,
    type AudioMode,
    type CommandResult,
} from './types';
import { WhisperModelStore } from './whisperModelStore';
import { WorkspaceStore } from './workspaceStore';

configure({ enforceActions: 'always' });

export interface StartTranscriptionOptions {
    language: string;
    model: WhisperModelName;
    modelPath?: string;
    maxContext?: number;
    maxLen?: number;
    splitOnWord: boolean;
    useVad: boolean;
}

export class AppStore {
    readonly activityLog = new ActivityLogStore();

    readonly operations = new ForegroundOperationStore();

    readonly workspace = new WorkspaceStore();

    readonly transcription = new TranscriptionStore();

    readonly whisperModels: WhisperModelStore;

    readonly recording: SystemAudioRecorderStore;

    private unsubscribeFunctions: Array<() => void> = [];

    private initialized = false;

    private disposed = false;

    private sessionsRequestId = 0;

    constructor(private readonly adapter: RendererAdapter | null) {
        this.whisperModels = new WhisperModelStore(adapter);
        this.recording = new SystemAudioRecorderStore({
            adapter,
            activityLog: this.activityLog,
            operations: this.operations,
            onSessionImported: (session) => this.acceptSession(session),
        });
        makeAutoObservable<this, 'adapter' | 'unsubscribeFunctions' | 'sessionsRequestId'>(this, {
            adapter: false,
            activityLog: false,
            operations: false,
            workspace: false,
            transcription: false,
            whisperModels: false,
            recording: false,
            unsubscribeFunctions: false,
            sessionsRequestId: false,
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

        if (this.adapter) {
            this.unsubscribeFunctions = [
                this.adapter.onTranscribeText((chunk) => this.handleTranscribeText(chunk)),
                this.adapter.onTranscribeProgress((value) => this.handleTranscribeProgress(value)),
                this.adapter.onTranscribeLog((line) => this.activityLog.appendProcessOutput(line)),
                this.adapter.onWhisperModelDownloadProgress((progress) => {
                    this.whisperModels.updateDownloadProgress(progress);
                }),
            ];
            void this.refreshSessions();
            void this.whisperModels.refresh();
        }

        this.recording.initialize();
    }

    dispose(): void {
        if (!this.initialized) return;

        this.initialized = false;
        this.disposed = true;
        this.unsubscribeFunctions.forEach((unsubscribe) => unsubscribe());
        this.unsubscribeFunctions = [];
        this.recording.dispose();
        this.operations.cancelActive();
        this.sessionsRequestId += 1;
    }

    async refreshSessions(): Promise<CommandResult> {
        if (!this.adapter) {
            this.workspace.replaceSessions([]);

            return commandSuccess(undefined);
        }

        const requestId = this.sessionsRequestId + 1;

        this.sessionsRequestId = requestId;
        this.workspace.setSessionsLoading(true);
        this.workspace.setSessionsLoadError(null);

        try {
            const sessions = await this.adapter.listSessions();

            if (this.disposed || requestId !== this.sessionsRequestId) {
                return commandFailure('The session list request was replaced.');
            }

            runInAction(() => {
                this.workspace.replaceSessions(sessions);
            });

            return commandSuccess(undefined);
        } catch (error: unknown) {
            if (requestId !== this.sessionsRequestId) {
                return commandFailure('The session list request was replaced.');
            }

            console.error('Failed to load sessions', error);
            runInAction(() => {
                this.workspace.setSessionsLoadError('Failed to load sessions.');
            });

            return commandFailure('Failed to load sessions.');
        } finally {
            if (requestId === this.sessionsRequestId) {
                runInAction(() => {
                    this.workspace.setSessionsLoading(false);
                });
            }
        }
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
        if (this.operations.isBusy) return commandFailure('Another workspace operation is already running.');

        try {
            await this.adapter.deleteSession(sessionId);

            runInAction(() => {
                this.workspace.removeSession(sessionId);

                if (this.workspace.activeSessionId === sessionId) {
                    this.workspace.clearWorkspace();
                    this.transcription.clearForWorkspaceChange();
                }
            });
            void this.refreshSessions();

            return commandSuccess(undefined);
        } catch (error: unknown) {
            console.error('Failed to delete session', error);

            return commandFailure('Failed to delete the session.');
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

    async startTranscription(options: StartTranscriptionOptions): Promise<CommandResult> {
        const audioPath = this.workspace.audioSourcePath;

        if (!this.adapter) return commandFailure('Transcription is not available.');
        if (!audioPath) return commandFailure('Choose an audio source before transcribing.');
        if (this.workspace.hasIncompleteSegment) {
            return commandFailure('Set both the start and end of the segment, with the end after the start.');
        }

        const operation = this.operations.begin('transcribing');

        if (!operation) return commandFailure('Another workspace operation is already running.');

        const selectedSegment = this.workspace.selectedSegment ?? undefined;
        const runId = this.transcription.beginRun(selectedSegment);
        const fileName = audioPath.split(/[/\\]/).pop() || audioPath;

        if (selectedSegment) {
            this.activityLog.appendEvent(
                `Transcribing segment ${selectedSegment.start.toFixed(2)} s — ${selectedSegment.end.toFixed(2)} s of ${fileName}`,
            );
        } else {
            this.activityLog.appendEvent(`Starting Whisper transcription for ${fileName}`);
        }

        const transcribeOptions: TranscribeOpts = {
            runId,
            language: options.language,
            model: options.model,
            sessionId: this.workspace.activeSessionId ?? undefined,
            modelPath: options.modelPath,
            maxContext: options.maxContext ?? -1,
            maxLen: options.maxLen ?? 0,
            splitOnWord: options.splitOnWord,
            useVad: options.useVad,
            segment: selectedSegment,
        };
        const startedAt = performance.now();

        try {
            const transcriptSource = await this.adapter.transcribe(audioPath, transcribeOptions);

            if (!this.operations.owns(operation) || !this.transcription.ownsRun(runId) || this.disposed) {
                return commandFailure('The transcription run is no longer active.');
            }

            runInAction(() => {
                this.transcription.completeRun(runId, transcriptSource);
            });
            const durationSeconds = Math.max(0, performance.now() - startedAt) / 1000;

            this.activityLog.appendEvent(`Whisper transcription finished for ${fileName}`);
            this.activityLog.appendEvent(`Processed ${fileName}: ${durationSeconds.toFixed(1)} s.`);
            void this.refreshSessions();

            return commandSuccess(undefined);
        } catch (error: unknown) {
            console.error('Whisper transcription failed', error);
            runInAction(() => {
                this.transcription.failRun(runId, 'Transcription failed.');
            });

            return commandFailure('Transcription failed.');
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

        try {
            const stopped = await this.adapter.stopTranscription();

            if (!this.operations.owns(operation) || this.disposed) {
                return commandFailure('The transcription run is no longer active.');
            }

            if (!stopped) return commandFailure('No transcription is running.');

            runInAction(() => {
                this.transcription.stopRun();
                this.operations.finish(operation);
            });
            this.activityLog.appendEvent('Transcription stopped.');

            return commandSuccess(undefined);
        } catch (error: unknown) {
            console.error('Failed to stop Whisper transcription', error);

            return commandFailure('Failed to stop transcription.');
        }
    }

    clearWorkspace(): CommandResult {
        if (this.operations.isBusy) return commandFailure('Another workspace operation is already running.');

        this.workspace.clearWorkspace();
        this.transcription.clearAll();

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

    async importCustomModel(): Promise<CommandResult<{ path: string; fileName: string } | null>> {
        if (!this.adapter) return commandFailure('Custom model import is not available.');

        try {
            const result = await this.adapter.importWhisperModelFromFile();

            if (!result) return commandSuccess(null);
            if (!result.ok) return commandFailure('Failed to import the model file.');

            return commandSuccess({ path: result.path, fileName: result.fileName });
        } catch (error: unknown) {
            console.error('Failed to import custom model', error);

            return commandFailure('Failed to import the model file.');
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
        this.workspace.replaceWorkspace(session);
        this.transcription.replaceSavedTranscript(session.transcript ?? null);
        void this.refreshSessions();
    }

    private handleTranscribeText(event: TranscriptionTextEvent): void {
        if (this.operations.kind !== 'transcribing' || !this.transcription.ownsRun(event?.runId)) return;

        if (typeof event.chunk !== 'string') return;

        this.transcription.appendDraft(event.chunk);
    }

    private handleTranscribeProgress(event: TranscriptionProgressEvent): void {
        if (this.operations.kind !== 'transcribing' || !this.transcription.ownsRun(event?.runId)) return;

        this.transcription.setProgress(event.value);
    }
}
