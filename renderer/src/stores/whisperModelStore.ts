import type { WhisperModelDownloadProgress, WhisperModelInfo, WhisperModelName } from 'electron/src/types/whisper';
import { makeAutoObservable, runInAction } from 'mobx';
import type { RendererAdapter } from './rendererAdapter';
import { commandFailure, commandSuccess, type CommandResult } from './types';

export class WhisperModelStore {
    private modelsValue: WhisperModelInfo[] = [];

    downloadProgress: WhisperModelDownloadProgress | null = null;

    constructor(private readonly adapter: RendererAdapter | null) {
        makeAutoObservable<this, 'adapter'>(
            this,
            { adapter: false },
            { autoBind: true },
        );
    }

    get models(): readonly WhisperModelInfo[] {
        return this.modelsValue;
    }

    get isDownloadActive(): boolean {
        return this.downloadProgress !== null;
    }

    getModel(name: WhisperModelName): WhisperModelInfo | undefined {
        return this.modelsValue.find((model) => model.name === name);
    }

    isDownloaded(name: WhisperModelName): boolean {
        return this.getModel(name)?.isDownloaded ?? false;
    }

    async refresh(): Promise<CommandResult> {
        if (!this.adapter) return commandFailure('Whisper models are not available.');

        try {
            const models = await this.adapter.getWhisperModels();

            runInAction(() => {
                this.modelsValue = models;
            });

            return commandSuccess(undefined);
        } catch (error: unknown) {
            console.error('Failed to load Whisper models', error);

            return commandFailure('Failed to load the available models.');
        }
    }

    async download(name: WhisperModelName): Promise<CommandResult> {
        if (!this.adapter) return commandFailure('Model download is not available.');

        this.downloadProgress = {
            name,
            percent: 0,
            downloadedBytes: 0,
            totalBytes: null,
        };

        try {
            await this.adapter.downloadWhisperModel(name);
            const refreshResult = await this.refresh();

            if (!refreshResult.ok) return refreshResult;

            return commandSuccess(undefined);
        } catch (error: unknown) {
            console.error('Failed to download Whisper model', error);

            return commandFailure('Failed to download the model. Please try again.');
        } finally {
            runInAction(() => {
                this.downloadProgress = null;
            });
        }
    }

    updateDownloadProgress(progress: WhisperModelDownloadProgress): void {
        this.downloadProgress = progress;
    }
}
