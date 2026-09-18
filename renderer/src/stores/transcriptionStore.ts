import type { SessionTranscriptV1 } from 'electron/src/types/sessions';
import { makeAutoObservable } from 'mobx';
import type { TranscriptionRunOutcome } from 'renderer/src/features/transcribe-state/src/model/transcriptionWorkflow';
import { parseTranscript, transcriptToHtml, transcriptToTimecodedText } from './transcriptFormat';
import type { DeepReadonly, Segment } from './types';

export class TranscriptionStore {
    private savedTranscriptValue: DeepReadonly<SessionTranscriptV1> | null = null;

    private draftSource = '';

    private draftOffsetSeconds = 0;

    private runId = 0;

    private progressValue = 0;

    private runOutcomeValue: TranscriptionRunOutcome = 'none';

    private runErrorMessageValue: string | null = null;

    get progress(): number {
        return this.progressValue;
    }

    get runOutcome(): TranscriptionRunOutcome {
        return this.runOutcomeValue;
    }

    get runErrorMessage(): string | null {
        return this.runErrorMessageValue;
    }

    constructor() {
        makeAutoObservable(this, {}, { autoBind: true });
    }

    get savedTranscript(): DeepReadonly<SessionTranscriptV1> | null {
        return this.savedTranscriptValue;
    }

    get draftTranscript(): DeepReadonly<SessionTranscriptV1> | null {
        return this.draftSource
            ? parseTranscript(this.draftSource, this.draftOffsetSeconds, true)
            : null;
    }

    get visibleTranscript(): DeepReadonly<SessionTranscriptV1> | null {
        return this.draftTranscript ?? this.savedTranscriptValue;
    }

    get timecodedText(): string {
        return transcriptToTimecodedText(this.visibleTranscript);
    }

    get plainText(): string {
        return this.visibleTranscript?.segments.map((segment) => segment.text).join(' ') ?? '';
    }

    get renderedHtml(): string {
        return transcriptToHtml(this.visibleTranscript);
    }

    get hasVisibleTranscript(): boolean {
        return Boolean(this.visibleTranscript?.segments.length);
    }

    beginRun(segment?: Segment): number {
        this.runId += 1;
        this.draftSource = '';
        this.draftOffsetSeconds = segment?.start ?? 0;
        this.progressValue = 0;
        this.runOutcomeValue = 'none';
        this.runErrorMessageValue = null;

        return this.runId;
    }

    ownsRun(runId: number): boolean {
        return this.runId === runId;
    }

    appendDraft(chunk: string): void {
        this.draftSource += chunk;
    }

    setProgress(value: number): void {
        this.progressValue = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
    }

    completeRun(runId: number, transcriptSource: string): void {
        if (!this.ownsRun(runId)) return;

        this.savedTranscriptValue = parseTranscript(transcriptSource, this.draftOffsetSeconds);
        this.draftSource = '';
        this.progressValue = 100;
        this.runOutcomeValue = 'success';
        this.runErrorMessageValue = null;
    }

    failRun(runId: number, message: string): void {
        if (!this.ownsRun(runId)) return;

        this.runOutcomeValue = 'error';
        this.runErrorMessageValue = message;
    }

    stopRun(): void {
        this.runId += 1;
        this.runOutcomeValue = 'stopped';
        this.runErrorMessageValue = null;
    }

    replaceSavedTranscript(transcript: DeepReadonly<SessionTranscriptV1> | null): void {
        this.runId += 1;
        this.savedTranscriptValue = transcript;
        this.draftSource = '';
        this.draftOffsetSeconds = 0;
        this.progressValue = 0;
        this.runOutcomeValue = transcript ? 'success' : 'none';
        this.runErrorMessageValue = null;
    }

    clearForWorkspaceChange(): void {
        this.replaceSavedTranscript(null);
    }

    clearAll(): void {
        this.replaceSavedTranscript(null);
    }
}
