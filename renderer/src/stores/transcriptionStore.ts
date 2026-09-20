import type { RecordingSource, SessionTranscriptSegmentV1, SessionTranscriptV1 } from 'electron/src/types/sessions';
import type { TranscribeOpts, TranscriptionProgressEvent, TranscriptionTextEvent } from 'electron/src/types/transcription';
import type { WhisperModelName } from 'electron/src/types/whisper';
import { makeAutoObservable, runInAction } from 'mobx';
import type { TranscriptionRunOutcome } from 'renderer/src/features/transcribe-state/src/model/transcriptionWorkflow';
import type { RendererAdapter } from './rendererAdapter';
import { formatTranscriptSegment, parseTranscript, transcriptToHtml, transcriptToTimecodedText } from './transcriptFormat';
import { commandFailure, commandSuccess, type CommandResult, type DeepReadonly, type Segment } from './types';

export interface StartTranscriptionOptions {
    language: string;
    model: WhisperModelName;
    modelPath?: string;
    maxContext?: number;
    maxLen?: number;
    splitOnWord: boolean;
    useVad: boolean;
}

export interface TranscriptionRunRequest {
    readonly audioPath: string;
    readonly sessionId?: string;
    readonly sourceAware?: boolean;
    readonly retryFailed?: boolean;
    readonly optimized?: boolean;
    readonly segment?: Readonly<Segment>;
    readonly options: Readonly<StartTranscriptionOptions>;
}

export type TranscriptionRunResult =
    | { readonly status: 'success' | 'incomplete' }
    | { readonly status: 'replaced' }
    | { readonly status: 'failed'; readonly message: string };

/** Owns one transcription run, its streaming listeners, and the visible transcript state. */
export class TranscriptionStore {
    private savedTranscriptValue: DeepReadonly<SessionTranscriptV1> | null = null;

    private draftSource = '';

    private sourceDrafts: Partial<Record<RecordingSource, { text: string; offset: number }>> = {};

    private sourceSessionId: string | null = null;

    private isRetryRun = false;

    private stopCompletion: Promise<void> | null = null;

    private stoppingRunId: number | null = null;

    private draftOffsetSeconds = 0;

    private runId = 0;

    private activeRunId: number | null = null;

    private runIsCurrent: (() => boolean) | null = null;

    private lifecycleId = 0;

    private initialized = false;

    private disposed = false;

    private unsubscribeFunctions: Array<() => void> = [];

    private progressValue = 0;

    private runOutcomeValue: TranscriptionRunOutcome = 'none';

    private runErrorMessageValue: string | null = null;

    constructor(private readonly adapter: RendererAdapter | null) {
        makeAutoObservable<this, 'adapter' | 'runIsCurrent' | 'unsubscribeFunctions' | 'stopCompletion' | 'stoppingRunId'>(this, {
            adapter: false,
            stopCompletion: false,
            stoppingRunId: false,
            runIsCurrent: false,
            unsubscribeFunctions: false,
        }, { autoBind: true });
    }

    get progress(): number {
        return this.progressValue;
    }

    get isRunning(): boolean {
        return this.activeRunId !== null;
    }

    get runOutcome(): TranscriptionRunOutcome {
        return this.runOutcomeValue;
    }

    get runErrorMessage(): string | null {
        return this.runErrorMessageValue;
    }

    get savedTranscript(): DeepReadonly<SessionTranscriptV1> | null {
        return this.savedTranscriptValue;
    }

    get isIncomplete(): boolean {
        return this.savedTranscriptValue?.sourceRun?.status === 'incomplete';
    }

    get hasCompletedSources(): boolean {
        return this.savedTranscriptValue?.sourceRun?.sources.some((source) => source.status === 'completed') ?? false;
    }

    get allSourcesFailed(): boolean {
        const sources = this.savedTranscriptValue?.sourceRun?.sources;

        return this.isIncomplete && Boolean(sources?.length) && sources?.every((source) => source.status === 'failed') === true;
    }

    get draftTranscript(): DeepReadonly<SessionTranscriptV1> | null {
        if (Object.keys(this.sourceDrafts).length > 0) {
            const segments: SessionTranscriptSegmentV1[] = this.isRetryRun ?
                (this.savedTranscriptValue?.segments.map((segment) => ({ ...segment })) ?? []) : [];

            for (const source of ['system', 'microphone'] as const) {
                const draft = this.sourceDrafts[source];

                if (draft) segments.push(...parseTranscript(draft.text, draft.offset, true).segments.map((segment) => ({ ...segment, source })));
            }

            segments.sort((left, right) => left.startSec - right.startSec);

            return { version: 1, segments };
        }
        return this.draftSource ?
            parseTranscript(this.draftSource, this.draftOffsetSeconds, true) :
            null;
    }

    get visibleTranscript(): DeepReadonly<SessionTranscriptV1> | null {
        return this.draftTranscript ?? this.savedTranscriptValue;
    }

    get timecodedText(): string {
        return transcriptToTimecodedText(this.visibleTranscript);
    }

    get plainText(): string {
        const segments = this.visibleTranscript?.segments ?? [];

        return segments.map(formatTranscriptSegment).join(segments.some((segment) => segment.source) ? '\n' : ' ');
    }

    get renderedHtml(): string {
        return transcriptToHtml(this.visibleTranscript);
    }

    get hasVisibleTranscript(): boolean {
        return Boolean(this.visibleTranscript?.segments.length);
    }

    initialize(): void {
        if (this.initialized) return;

        this.initialized = true;
        this.disposed = false;
        this.lifecycleId += 1;

        if (!this.adapter) return;

        this.unsubscribeFunctions = [
            this.adapter.onTranscribeText((event) => this.handleTranscribeText(event)),
            this.adapter.onTranscribeProgress((event) => this.handleTranscribeProgress(event)),
        ];
    }

    dispose(): void {
        if (!this.initialized) return;

        this.initialized = false;
        this.disposed = true;
        this.lifecycleId += 1;
        this.invalidateRun();
        this.unsubscribeFunctions.forEach((unsubscribe) => unsubscribe());
        this.unsubscribeFunctions = [];
    }

    async start(request: TranscriptionRunRequest, isCurrent: () => boolean): Promise<TranscriptionRunResult> {
        if (!this.adapter) return { status: 'failed', message: 'Transcription is not available.' };
        if (this.disposed) return { status: 'failed', message: 'The transcription run is no longer active.' };
        if (this.activeRunId !== null) {
            return { status: 'failed', message: 'A transcription run is already active.' };
        }
        if (!isCurrent()) return { status: 'replaced' };

        const runId = this.beginRun(request.segment, isCurrent);
        const lifecycleId = this.lifecycleId;

        this.sourceSessionId = request.sourceAware ? request.sessionId ?? null : null;
        this.isRetryRun = request.retryFailed === true;
        const transcribeOptions: TranscribeOpts = {
            runId,
            language: request.options.language,
            model: request.options.model,
            sessionId: request.sessionId,
            modelPath: request.options.modelPath,
            maxContext: request.options.maxContext ?? -1,
            maxLen: request.options.maxLen ?? 0,
            splitOnWord: request.options.splitOnWord,
            useVad: request.options.useVad,
            segment: request.segment ? { ...request.segment } : undefined,
        };

        try {
            if (request.sourceAware && request.sessionId) {
                const session = await this.adapter.transcribeSession(request.sessionId, {
                    ...transcribeOptions,
                    retryFailed: request.retryFailed,
                    optimized: request.optimized,
                });

                if (request.sourceAware && this.stoppingRunId === runId && this.stopCompletion) await this.stopCompletion;
                if (!this.isRunCurrent(runId, lifecycleId, isCurrent)) return { status: 'replaced' };

                runInAction(() => {
                    const progress = this.progressValue;

                    this.replaceSavedTranscript(session.transcript ?? null);
                    this.progressValue = this.isIncomplete ? progress : 100;
                });

                if (this.allSourcesFailed) {
                    return { status: 'failed', message: 'Transcription failed for all recording sources.' };
                }

                return { status: this.isIncomplete ? 'incomplete' : 'success' };
            }

            const transcriptSource = await this.adapter.transcribe(request.audioPath, transcribeOptions);

            if (request.sourceAware && this.stoppingRunId === runId && this.stopCompletion) await this.stopCompletion;
            if (!this.isRunCurrent(runId, lifecycleId, isCurrent)) return { status: 'replaced' };

            runInAction(() => {
                this.completeRun(runId, transcriptSource);
            });

            return { status: 'success' };
        } catch (error: unknown) {
            if (request.sourceAware && this.stoppingRunId === runId && this.stopCompletion) await this.stopCompletion;
            if (!this.isRunCurrent(runId, lifecycleId, isCurrent)) return { status: 'replaced' };

            console.error('Whisper transcription failed', error);
            runInAction(() => {
                this.failRun(runId, 'Transcription failed.');
            });

            return { status: 'failed', message: 'Transcription failed.' };
        }
    }

    async stop(isCurrent: () => boolean): Promise<CommandResult> {
        if (!this.adapter || this.activeRunId === null) return commandFailure('No transcription is running.');
        if (this.stopCompletion && this.stoppingRunId === this.activeRunId) return commandFailure('Transcription is already stopping.');

        const runId = this.activeRunId;
        const lifecycleId = this.lifecycleId;
        let finishStop: () => void = () => undefined;

        // Let cancellation own the final state even if the inference request settles first.
        this.stoppingRunId = runId;
        this.stopCompletion = new Promise<void>((resolve) => { finishStop = resolve; });

        try {
            const stopped = await this.adapter.stopTranscription();

            if (!this.isRunCurrent(runId, lifecycleId, isCurrent)) {
                return commandFailure('The transcription run is no longer active.');
            }

            if (!stopped) return commandFailure('No transcription is running.');

            const sourceSessionId = this.sourceSessionId;

            if (sourceSessionId) {
                try {
                    const session = await this.adapter.getSession(sourceSessionId);

                    if (!this.isRunCurrent(runId, lifecycleId, isCurrent)) {
                        return commandFailure('The transcription run is no longer active.');
                    }
                    runInAction(() => {
                        this.savedTranscriptValue = session.transcript ?? null;
                        this.sourceDrafts = {};
                    });
                } catch (error: unknown) {
                    console.error('Failed to reload completed recording source transcripts', error);
                }
            }
            runInAction(() => {
                this.stopRun(runId);
            });

            return commandSuccess(undefined);
        } catch (error: unknown) {
            if (!this.isRunCurrent(runId, lifecycleId, isCurrent)) {
                return commandFailure('The transcription run is no longer active.');
            }

            console.error('Failed to stop Whisper transcription', error);

            return commandFailure('Failed to stop transcription.');
        } finally {
            if (this.stoppingRunId === runId) {
                this.stopCompletion = null;
                this.stoppingRunId = null;
            }
            finishStop();
        }
    }

    replaceSavedTranscript(transcript: DeepReadonly<SessionTranscriptV1> | null): void {
        this.invalidateRun();
        this.savedTranscriptValue = transcript;
        this.draftSource = '';
        this.sourceDrafts = {};
        this.draftOffsetSeconds = 0;
        this.progressValue = 0;
        this.runOutcomeValue = this.isIncomplete ? 'error' : transcript ? 'success' : 'none';
        this.runErrorMessageValue = this.allSourcesFailed ? 'Transcription failed for all recording sources.' :
            this.isIncomplete ? 'Transcription is incomplete. Retry the remaining sources.' : null;
    }

    clear(): void {
        this.replaceSavedTranscript(null);
    }

    private beginRun(segment: Segment | undefined, isCurrent: () => boolean): number {
        this.runId += 1;
        this.activeRunId = this.runId;
        this.runIsCurrent = isCurrent;
        this.draftSource = '';
        this.sourceDrafts = {};
        this.draftOffsetSeconds = segment?.start ?? 0;
        this.progressValue = 0;
        this.runOutcomeValue = 'none';
        this.runErrorMessageValue = null;

        return this.runId;
    }

    private completeRun(runId: number, transcriptSource: string): void {
        if (this.activeRunId !== runId) return;

        this.savedTranscriptValue = parseTranscript(transcriptSource, this.draftOffsetSeconds);
        this.draftSource = '';
        this.sourceDrafts = {};
        this.progressValue = 100;
        this.runOutcomeValue = 'success';
        this.runErrorMessageValue = null;
        this.activeRunId = null;
        this.runIsCurrent = null;
    }

    private failRun(runId: number, message: string): void {
        if (this.activeRunId !== runId) return;

        this.runOutcomeValue = 'error';
        this.runErrorMessageValue = message;
        this.activeRunId = null;
        this.runIsCurrent = null;
    }

    private stopRun(runId: number): void {
        if (this.activeRunId !== runId) return;

        this.runId += 1;
        this.activeRunId = null;
        this.runIsCurrent = null;
        this.runOutcomeValue = 'stopped';
        this.runErrorMessageValue = null;
    }

    private invalidateRun(): void {
        this.runId += 1;
        this.activeRunId = null;
        this.runIsCurrent = null;
    }

    private isRunCurrent(runId: number, lifecycleId: number, isCurrent: () => boolean): boolean {
        return !this.disposed
            && this.lifecycleId === lifecycleId
            && this.activeRunId === runId
            && this.runId === runId
            && isCurrent();
    }

    private handleTranscribeText(event: TranscriptionTextEvent): void {
        if (!event || typeof event.chunk !== 'string') return;
        if (!this.isEventCurrent(event.runId)) return;

        if (event.source) {
            const previous = this.sourceDrafts[event.source];

            this.sourceDrafts[event.source] = {
                text: (previous?.text ?? '') + event.chunk,
                offset: event.offsetSec ?? previous?.offset ?? this.draftOffsetSeconds,
            };
        } else {
            this.draftSource += event.chunk;
        }
    }

    private handleTranscribeProgress(event: TranscriptionProgressEvent): void {
        if (!event || !this.isEventCurrent(event.runId)) return;

        this.progressValue = Number.isFinite(event.value) ? Math.min(100, Math.max(0, event.value)) : 0;
    }

    private isEventCurrent(runId: number): boolean {
        return this.activeRunId === runId
            && this.runId === runId
            && this.runIsCurrent?.() === true
            && !this.disposed;
    }
}
