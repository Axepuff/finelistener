import type { SessionSummary, SessionSummaryDraft, SummaryGenerationFailure } from 'electron/src/types/sessions';
import type { SummaryModelStatus } from 'electron/src/types/summaryModel';
import type { ActivityLogStore } from './activityLogStore';
import { makeAutoObservable, runInAction } from 'mobx';
import { defaultRecordingSummaryOptions, type RecordingSummaryOptions } from '../../../electron/src/types/summaryOptions';
import type { ForegroundOperationStore } from './foregroundOperationStore';
import type { RendererAdapter } from './rendererAdapter';
import { ProgressEstimate } from './progressEstimate';
import { SummaryPresetStore } from './summaryPresetStore';

interface SummaryRequestFailure {
    sessionId: string;
    prompt: string;
    reason: Exclude<SummaryGenerationFailure, 'cancelled'>;
}

const generationMessages: Record<SummaryRequestFailure['reason'], string> = {
    busy: 'Another operation is in progress.',
    'model-missing': 'Download the summary model to generate a summary.',
    'runtime-unavailable': 'The local summary service is unavailable.',
    'no-transcript': 'A complete transcript is required.',
    'prompt-too-long': 'The prompt is too long for the available context. Shorten it and try again.',
    'transcript-changed': 'The transcript changed. Generate the summary again.',
    'draft-incompatible': 'The saved progress cannot be continued. Generate the summary again.',
    failed: 'Could not generate the summary. Try again.',
};

export class SummaryStore {
    readonly downloadEstimate = new ProgressEstimate();
    readonly presets: SummaryPresetStore;
    editedPrompt: string | undefined;
    private generateAfterDownloadFor: string | null = null;
    private progressValue = '';
    private runningOptionsValue?: RecordingSummaryOptions;
    private generationFailureValue: SummaryRequestFailure | null = null;
    private stopError: string | null = null;
    private stopping = false;
    private stoppedValue = false;
    private modelValue: SummaryModelStatus | null = null;
    private modelFailure: string | null = null;
    private modelRequest = 0;
    private downloadPending: symbol | null = null;
    private unsubscribeModel: (() => void) | null = null;
    private unsubscribe: (() => void) | null = null;

    constructor(private readonly adapter: RendererAdapter | null, private readonly operations: ForegroundOperationStore,
        private readonly activityLog: ActivityLogStore | null = null,
        private readonly onDownloadReady?: (sessionId: string, prompt: string) => void) {
        this.presets = new SummaryPresetStore(adapter);
        makeAutoObservable<this, 'adapter' | 'activityLog' | 'operations' | 'unsubscribe' | 'unsubscribeModel' | 'modelRequest' | 'onDownloadReady'>(this, {
            adapter: false, activityLog: false, operations: false, unsubscribe: false, unsubscribeModel: false, modelRequest: false,
            onDownloadReady: false,
        }, { autoBind: true });
    }

    get isRunning(): boolean { return this.operations.kind === 'summarizing'; }
    get isStopping(): boolean { return this.stopping; }
    get progress(): string { return this.progressValue; }
    get runningOptions(): Readonly<RecordingSummaryOptions> | undefined { return this.runningOptionsValue; }
    get generationFailure(): Readonly<SummaryRequestFailure> | null { return this.generationFailureValue; }
    get error(): string | null {
        return this.stopError ?? (this.generationFailureValue ? generationMessages[this.generationFailureValue.reason] : null);
    }
    get stopped(): boolean { return this.stoppedValue; }
    get modelStatus(): SummaryModelStatus | null { return this.modelValue; }
    get automaticGenerationSession(): string | null { return this.generateAfterDownloadFor; }

    setPrompt(value: string): void { this.editedPrompt = value; }

    setGenerateAfterDownload(sessionId: string, prompt: string, enabled: boolean): void {
        if (this.modelValue?.state !== 'downloading') return;
        this.generateAfterDownloadFor = enabled ? sessionId : null;
        if (enabled) this.editedPrompt = prompt;
    }

    leaveSession(): void {
        this.editedPrompt = undefined;
        this.generateAfterDownloadFor = null;
        this.clearError();
    }
    get modelError(): string | null {
        if (this.modelFailure) return this.modelFailure;
        if (this.modelValue?.state !== 'error') return null;
        if (this.modelValue.error === 'disk-space') return 'There is not enough space to install the model.';
        if (this.modelValue.error === 'storage') return 'Could not access the local model files.';
        return 'Could not download the model. Check your connection and try again.';
    }

    private setModelStatus(status: SummaryModelStatus): void {
        const previous = this.modelValue;
        if (status.state === 'downloading' && status.totalBytes > 0) {
            const fraction = status.downloadedBytes / status.totalBytes;
            if (previous?.state === 'downloading') this.downloadEstimate.update(fraction);
            else this.downloadEstimate.start(fraction);
        }
        if (status.state === 'error' && (previous?.state !== 'error' || previous.error !== status.error || previous.downloadedBytes !== status.downloadedBytes)) {
            this.activityLog?.appendFailure('Summary model download failed', `reason=${status.error}; model=${status.model}; reached=${status.downloadedBytes}/${status.totalBytes} bytes`);
        }
        this.modelValue = status;
        this.modelFailure = null;
        if (status.state !== 'downloading') {
            const sessionId = this.generateAfterDownloadFor;
            this.generateAfterDownloadFor = null;
            if (sessionId && previous?.state === 'downloading' && status.state === 'ready' && this.editedPrompt !== undefined) {
                this.onDownloadReady?.(sessionId, this.editedPrompt);
            }
        }
    }

    initialize(): void {
        if (!this.adapter || this.unsubscribeModel) return;
        void this.presets.load();
        this.unsubscribeModel = this.adapter.onSummaryModelChanged((status) => {
            runInAction(() => {
                this.modelRequest += 1;
                this.setModelStatus(status);
            });
        });
    }

    async refreshModelStatus(): Promise<void> {
        if (!this.adapter || !this.unsubscribeModel) return;
        const request = ++this.modelRequest;
        try {
            const status = await this.adapter.getSummaryModelStatus();
            if (request === this.modelRequest) runInAction(() => {
                this.setModelStatus(status);
            });
        } catch (error) {
            console.error('Failed to read the summary model status', error);
            if (request === this.modelRequest) runInAction(() => {
                this.modelValue = null;
                this.generateAfterDownloadFor = null;
                this.modelFailure = 'Could not check whether the model is installed.';
                this.activityLog?.appendFailure('Summary model availability check failed', error);
            });
        }
    }

    async downloadModel(): Promise<void> {
        if (!this.adapter || !this.unsubscribeModel || this.downloadPending
            || this.modelValue?.state === 'downloading' || this.modelValue?.state === 'ready') return;
        const attempt = Symbol();
        this.downloadPending = attempt;
        this.modelFailure = null;
        this.modelRequest += 1;
        try {
            const status = await this.adapter.downloadSummaryModel();
            if (this.downloadPending === attempt) runInAction(() => {
                this.modelRequest += 1;
                this.setModelStatus(status);
            });
        } catch (error) {
            console.error('Failed to install the summary model', error);
            if (this.downloadPending === attempt) runInAction(() => {
                this.modelFailure = 'Could not download the model. Try again.';
                this.generateAfterDownloadFor = null;
                this.activityLog?.appendFailure('Summary model download failed', error);
            });
        } finally {
            if (this.downloadPending === attempt) runInAction(() => { this.downloadPending = null; });
        }
    }

    async cancelModelDownload(): Promise<void> {
        if (!this.adapter || !this.unsubscribeModel || (!this.downloadPending && this.modelValue?.state !== 'downloading')) return;
        const attempt = this.downloadPending;
        this.generateAfterDownloadFor = null;
        const request = ++this.modelRequest;
        try {
            const status = await this.adapter.cancelSummaryModelDownload();
            runInAction(() => {
                // The cancel acknowledgement and the original download reply can arrive independently.
                if (attempt && this.downloadPending === attempt && status.state !== 'downloading') this.downloadPending = null;
                if (request === this.modelRequest) {
                    this.setModelStatus(status);
                }
            });
        } catch (error) {
            console.error('Failed to cancel the summary model download', error);
            if (request === this.modelRequest) runInAction(() => {
                this.modelFailure = 'Could not cancel the model download. Try again.';
                this.activityLog?.appendFailure('Summary model download cancellation failed', error);
            });
        }
    }

    async generate(sessionId: string, options: RecordingSummaryOptions | undefined, onSaved: (summary: SessionSummary) => void,
        onDraft?: (draft: SessionSummaryDraft) => void): Promise<void> {
        if (!this.adapter) return;
        const operation = this.operations.begin('summarizing');
        if (!operation) return;
        const prompt = options?.prompt ?? defaultRecordingSummaryOptions.prompt;
        this.clearError();
        this.stopping = false;
        this.runningOptionsValue = options;
        this.progressValue = 'Preparing summary…';
        try {
            this.unsubscribe = this.adapter.onSummaryProgress((event) => {
                if (this.operations.owns(operation) && event.sessionId === sessionId) {
                    runInAction(() => { this.progressValue = event.message; });
                    if (event.saved) onSaved(event.saved);
                    if (event.draft) onDraft?.(event.draft);
                }
            });
            const result = await this.adapter.generateSummary(sessionId, options);
            if (!this.operations.owns(operation)) return;
            if (result.ok) onSaved(result.summary);
            else {
                const { reason } = result;
                this.activityLog?.appendFailure(`Summary generation ${reason === 'cancelled' ? 'stopped' : 'failed'} · session ${sessionId}`, `reason=${reason}`);
                runInAction(() => {
                    this.stopError = null;
                    this.stoppedValue = reason === 'cancelled';
                    if (reason !== 'cancelled') this.generationFailureValue = { sessionId, prompt, reason };
                });
                if (reason === 'model-missing') await this.refreshModelStatus();
            }
        } catch (error) {
            console.error('Failed to request the recording summary', error);
            if (this.operations.owns(operation)) runInAction(() => {
                this.stopError = null;
                this.generationFailureValue = { sessionId, prompt, reason: 'failed' };
                this.activityLog?.appendFailure(`Summary generation failed · session ${sessionId}`, error);
            });
        } finally {
            if (this.operations.owns(operation)) {
                this.unsubscribe?.();
                this.unsubscribe = null;
                runInAction(() => {
                    this.stopping = false;
                    this.runningOptionsValue = undefined;
                    this.operations.finish(operation);
                });
            }
        }
    }

    async stop(): Promise<void> {
        const operation = this.operations.active;
        if (operation?.kind !== 'summarizing' || !this.adapter || this.stopping) return;
        this.stopping = true;
        try {
            await this.adapter.stopSummary();
        } catch (error) {
            console.error('Failed to stop summary generation', error);
            if (this.operations.owns(operation)) runInAction(() => {
                this.stopping = false;
                this.stopError = 'Could not stop summary generation. Try again.';
                this.activityLog?.appendFailure(`Summary stop failed · operation ${operation.id}`, error);
            });
        }
    }

    clearError(): void {
        this.generationFailureValue = null;
        this.stopError = null;
        this.stoppedValue = false;
    }

    dispose(): void {
        this.presets.dispose();
        if (this.isRunning) void this.stop();
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.unsubscribeModel?.();
        this.unsubscribeModel = null;
        this.modelRequest += 1;
        this.downloadPending = null;
        this.modelValue = null;
        this.runningOptionsValue = undefined;
        this.modelFailure = null;
        this.leaveSession();
    }
}
