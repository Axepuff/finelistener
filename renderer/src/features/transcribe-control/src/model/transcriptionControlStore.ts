import type { WhisperModelName } from 'electron/src/types/whisper';
import { makeAutoObservable } from 'mobx';
import type { StartTranscriptionOptions } from 'renderer/src/stores/transcriptionStore';
import type { CommandResult } from 'renderer/src/stores/types';

export interface CustomModelFile {
    path: string;
    fileName: string;
}

export interface PendingModelDownload {
    readonly id: number;
    readonly model: WhisperModelName;
}

export type TranscriptionStartPreparation =
    | { readonly status: 'ready'; readonly options: StartTranscriptionOptions }
    | { readonly status: 'awaiting-download' }
    | { readonly status: 'failed'; readonly message: string };

/** Owns control settings and identifies one confirmed download that may continue a transcription request. */
export class TranscriptionControlStore {
    private languageValue = 'ru';
    private modelValue: WhisperModelName = 'large';
    private useCustomModelFileValue = false;
    private customModelFileValue: CustomModelFile | null = null;
    private maxContextValue: number | null = null;
    private maxLenValue: number | null = null;
    private splitOnWordValue = true;
    private useVadValue = true;
    private pendingStartIntent: PendingModelDownload | null = null;
    private isDownloadingPendingModelValue = false;
    private nextIntentId = 1;

    constructor() {
        makeAutoObservable(this, {}, { autoBind: true });
    }

    get language(): string {
        return this.languageValue;
    }

    get model(): WhisperModelName {
        return this.modelValue;
    }

    get useCustomModelFile(): boolean {
        return this.useCustomModelFileValue;
    }

    get customModelFile(): Readonly<CustomModelFile> | null {
        return this.customModelFileValue;
    }

    get maxContext(): number | null {
        return this.maxContextValue;
    }

    get maxLen(): number | null {
        return this.maxLenValue;
    }

    get splitOnWord(): boolean {
        return this.splitOnWordValue;
    }

    get useVad(): boolean {
        return this.useVadValue;
    }

    get pendingDownloadModel(): WhisperModelName | null {
        return this.pendingStartIntent?.model ?? null;
    }

    get isDownloadingPendingModel(): boolean {
        return this.isDownloadingPendingModelValue;
    }

    setLanguage(language: string): void {
        this.languageValue = language;
    }

    setModel(model: WhisperModelName): void {
        this.modelValue = model;
    }

    setUseCustomModelFile(useCustomModelFile: boolean): void {
        this.useCustomModelFileValue = useCustomModelFile;
    }

    setCustomModelFile(customModelFile: CustomModelFile | null): void {
        this.customModelFileValue = customModelFile;
    }

    setMaxContext(maxContext: number | null): void {
        this.maxContextValue = maxContext;
    }

    setMaxLen(maxLen: number | null): void {
        this.maxLenValue = maxLen;
    }

    setSplitOnWord(splitOnWord: boolean): void {
        this.splitOnWordValue = splitOnWord;
    }

    setUseVad(useVad: boolean): void {
        this.useVadValue = useVad;
    }

    requestStart(isModelDownloaded: boolean): TranscriptionStartPreparation {
        if (this.pendingStartIntent) return { status: 'awaiting-download' };
        if (this.useCustomModelFileValue || isModelDownloaded) return this.prepareStart(this.modelValue);

        this.pendingStartIntent = { id: this.nextIntentId, model: this.modelValue };
        this.nextIntentId += 1;

        return { status: 'awaiting-download' };
    }

    beginPendingDownload(): PendingModelDownload | null {
        if (!this.pendingStartIntent || this.isDownloadingPendingModelValue) return null;

        this.modelValue = this.pendingStartIntent.model;
        this.isDownloadingPendingModelValue = true;

        return this.pendingStartIntent;
    }

    completePendingDownload(
        intent: PendingModelDownload,
        downloadResult: CommandResult,
    ): TranscriptionStartPreparation | null {
        if (!this.isCurrentIntent(intent)) return null;

        this.isDownloadingPendingModelValue = false;
        this.pendingStartIntent = null;

        if (!downloadResult.ok) return { status: 'failed', message: downloadResult.message };

        return this.prepareStart(intent.model);
    }

    cancelPendingDownload(): void {
        this.invalidatePendingIntent();
    }

    dispose(): void {
        this.invalidatePendingIntent();
    }

    private prepareStart(model: WhisperModelName): TranscriptionStartPreparation {
        if (this.useCustomModelFileValue && !this.customModelFileValue) {
            return { status: 'failed', message: 'No custom model file selected.' };
        }

        return {
            status: 'ready',
            options: {
                language: this.languageValue,
                model,
                modelPath: this.useCustomModelFileValue ? this.customModelFileValue?.path : undefined,
                maxContext: this.maxContextValue ?? undefined,
                maxLen: this.maxLenValue ?? undefined,
                splitOnWord: this.splitOnWordValue,
                useVad: this.useVadValue,
            },
        };
    }

    private isCurrentIntent(intent: PendingModelDownload): boolean {
        return this.pendingStartIntent?.id === intent.id
            && this.isDownloadingPendingModelValue;
    }

    private invalidatePendingIntent(): void {
        this.pendingStartIntent = null;
        this.isDownloadingPendingModelValue = false;
    }
}
