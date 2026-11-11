import type { WhisperModelDownloadProgress, WhisperModelInfo, WhisperModelName } from 'electron/src/types/whisper';
import { makeAutoObservable, runInAction } from 'mobx';
import type { RendererAdapter } from './rendererAdapter';
import { commandFailure, commandSuccess, type CommandResult, type DeepReadonly } from './types';

export class WhisperModelStore {
    private modelsValue: WhisperModelInfo[] = [];

    private downloadProgressValue: WhisperModelDownloadProgress | null = null;

    private unsubscribeProgress: (() => void) | null = null;

    private requestId = 0;

    private lifecycleId = 0;

    private initialized = false;

    private disposed = false;

    constructor(private readonly adapter: RendererAdapter | null) {
        makeAutoObservable<this, 'adapter' | 'unsubscribeProgress' | 'requestId' | 'lifecycleId' | 'initialized' | 'disposed'>(
            this,
            {
                adapter: false,
                unsubscribeProgress: false,
                requestId: false,
                lifecycleId: false,
                initialized: false,
                disposed: false,
            },
            { autoBind: true },
        );
    }

    get models(): readonly DeepReadonly<WhisperModelInfo>[] {
        return this.modelsValue;
    }

    get downloadProgress(): DeepReadonly<WhisperModelDownloadProgress> | null {
        return this.downloadProgressValue;
    }

    get isDownloadActive(): boolean {
        return this.downloadProgress !== null;
    }

    getModel(name: WhisperModelName): DeepReadonly<WhisperModelInfo> | undefined {
        return this.modelsValue.find((model) => model.name === name);
    }

    isDownloaded(name: WhisperModelName): boolean {
        return this.getModel(name)?.isDownloaded ?? false;
    }

    initialize(): void {
        if (this.initialized) return;

        this.initialized = true;
        this.disposed = false;
        const lifecycleId = ++this.lifecycleId;

        if (this.adapter) {
            this.unsubscribeProgress = this.adapter.onWhisperModelDownloadProgress((progress) => {
                if (this.isCurrentLifecycle(lifecycleId)) this.updateDownloadProgress(progress);
            });
            void this.refresh();
        }
    }

    dispose(): void {
        this.initialized = false;
        this.disposed = true;
        this.lifecycleId += 1;
        this.requestId += 1;
        this.unsubscribeProgress?.();
        this.unsubscribeProgress = null;
        // Downloads continue in main; retain their reservation until the command settles.
    }

    async refresh(): Promise<CommandResult> {
        if (!this.adapter || this.disposed) return commandFailure('Whisper models are not available.');

        const requestId = ++this.requestId;

        try {
            const models = await this.adapter.getWhisperModels();

            if (this.disposed || requestId !== this.requestId) {
                return commandFailure('The model list request was replaced.');
            }

            runInAction(() => {
                this.modelsValue = models;
            });

            return commandSuccess(undefined);
        } catch (error: unknown) {
            if (this.disposed || requestId !== this.requestId) {
                return commandFailure('The model list request was replaced.');
            }

            console.error('Failed to load Whisper models', error);

            return commandFailure('Failed to load the available models.');
        }
    }

    async download(name: WhisperModelName): Promise<CommandResult> {
        if (!this.adapter || this.disposed) return commandFailure('Model download is not available.');
        if (this.isDownloadActive) return commandFailure('Model download is already in progress.');

        this.downloadProgressValue = {
            name,
            percent: 0,
            downloadedBytes: 0,
            totalBytes: null,
        };

        try {
            await this.adapter.downloadWhisperModel(name);
            return await this.refresh();
        } catch (error: unknown) {
            console.error('Failed to download Whisper model', error);

            return commandFailure('Failed to download the model. Please try again.');
        } finally {
            runInAction(() => {
                this.downloadProgressValue = null;
            });
        }
    }

    private updateDownloadProgress(progress: WhisperModelDownloadProgress): void {
        if (progress.name === this.downloadProgressValue?.name) this.downloadProgressValue = progress;
    }

    private isCurrentLifecycle(lifecycleId: number): boolean {
        return !this.disposed && lifecycleId === this.lifecycleId;
    }

    async importCustomModel(): Promise<CommandResult<{ path: string; fileName: string } | null>> {
        if (!this.adapter || this.disposed) return commandFailure('Custom model import is not available.');

        const lifecycleId = this.lifecycleId;

        try {
            const result = await this.adapter.importWhisperModelFromFile();

            if (!this.isCurrentLifecycle(lifecycleId)) return commandFailure('Custom model import is no longer active.');

            if (!result) return commandSuccess(null);
            if (!result.ok) return commandFailure('Failed to import the model file.');

            return commandSuccess({ path: result.path, fileName: result.fileName });
        } catch (error: unknown) {
            if (!this.isCurrentLifecycle(lifecycleId)) return commandFailure('Custom model import is no longer active.');

            console.error('Failed to import custom model', error);

            return commandFailure('Failed to import the model file.');
        }
    }
}
