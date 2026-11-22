import type { WhisperModelName } from 'electron/src/types/whisper';
import { makeAutoObservable } from 'mobx';
import type { StartTranscriptionOptions } from 'renderer/src/stores/transcriptionStore';

export interface CustomModelFile {
    path: string;
    fileName: string;
}

export type TranscriptionStartPreparation =
    | { readonly status: 'ready'; readonly options: StartTranscriptionOptions }
    | { readonly status: 'failed'; readonly message: string };

/** Owns transcription settings and prepares explicit starts for ready models. */
export class TranscriptionControlStore {
    private languageValue = 'ru';
    private modelValue: WhisperModelName = 'large';
    private useCustomModelFileValue = false;
    private customModelFileValue: CustomModelFile | null = null;
    private maxContextValue: number | null = null;
    private maxLenValue: number | null = null;
    private splitOnWordValue = true;
    private useVadValue = true;
    private microphoneGateEnabledValue = true;

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

    get microphoneGateEnabled(): boolean {
        return this.microphoneGateEnabledValue;
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

    setMicrophoneGateEnabled(enabled: boolean): void {
        this.microphoneGateEnabledValue = enabled;
    }

    requestStart(isModelDownloaded: boolean): TranscriptionStartPreparation {
        if (!this.useCustomModelFileValue && !isModelDownloaded) {
            return { status: 'failed', message: 'Download the selected model to transcribe.' };
        }
        return this.prepareStart(this.modelValue);
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
                microphoneGateEnabled: this.microphoneGateEnabledValue,
            },
        };
    }
}
