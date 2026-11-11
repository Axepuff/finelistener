import type { SpeakerAnalysisProgressEvent, SpeakerAssetStatus } from 'electron/src/types/transcription';
import { makeAutoObservable, runInAction } from 'mobx';
import type { RendererAdapter } from './rendererAdapter';

export class SpeakerAnalysisStore {
    enabled = true;

    speakerCount: number | null = null;

    phase: SpeakerAnalysisProgressEvent['phase'] | null = null;

    downloadedBytes = 0;

    totalBytes = 0;

    percent: number | null = null;

    status: 'idle' | 'running' | 'success' | 'error' | 'cancelled' = 'idle';

    errorMessage: string | null = null;

    usedCpuFallback = false;

    assets: SpeakerAssetStatus | null = null;

    private preferenceRequestId = 0;

    private assetRequestId = 0;

    private disposed = false;

    constructor(private readonly adapter: RendererAdapter | null) {
        makeAutoObservable<this, 'adapter'>(this, { adapter: false }, { autoBind: true });
    }

    initialize(): void {
        this.disposed = false;
        const requestId = ++this.preferenceRequestId;

        void this.adapter?.getUiPreference('speakerLabelsEnabled').then((enabled) => {
            if (this.disposed || requestId !== this.preferenceRequestId) return;
            runInAction(() => { this.enabled = enabled; });
        }).catch((error: unknown) => {
            console.error('Failed to load speaker label preference', error);
        });
        void this.refreshAssets();
    }

    dispose(): void {
        this.disposed = true;
        this.preferenceRequestId += 1;
        this.assetRequestId += 1;
    }

    async setEnabled(enabled: boolean): Promise<void> {
        this.preferenceRequestId += 1;
        this.enabled = enabled;

        try {
            await this.adapter?.setUiPreference('speakerLabelsEnabled', enabled);
        } catch (error: unknown) {
            console.error('Failed to save speaker label preference', error);
        }
    }

    setSpeakerCount(count: number | null): void {
        this.speakerCount = count !== null && Number.isSafeInteger(count) && count > 0 ? count : null;
    }

    async refreshAssets(): Promise<void> {
        const requestId = ++this.assetRequestId;
        try {
            const assets = await this.adapter?.getSpeakerAssets();
            if (assets && !this.disposed && requestId === this.assetRequestId) {
                runInAction(() => { this.assets = assets; });
            }
        } catch (error: unknown) {
            console.error('Failed to read speaker analysis assets', error);
        }
    }

    setAssets(assets: SpeakerAssetStatus): void {
        this.assetRequestId += 1;
        this.assets = assets;
    }

    begin(): void {
        this.percent = null;
        this.status = 'running';
        this.phase = 'preparing';
        this.downloadedBytes = 0;
        this.totalBytes = 0;
        this.errorMessage = null;
        this.usedCpuFallback = false;
    }

    updateProgress(event: SpeakerAnalysisProgressEvent): void {
        if (this.status !== 'running') return;
        this.phase = event.phase;
        this.percent = event.percent !== undefined && Number.isFinite(event.percent) ?
            Math.max(0, Math.min(100, event.percent)) : null;
        if (event.phase === 'fallback') this.usedCpuFallback = true;
        this.downloadedBytes = event.downloadedBytes ?? 0;
        this.totalBytes = event.totalBytes ?? 0;
    }

    succeed(): void {
        this.status = 'success';
        this.phase = null;
        this.errorMessage = null;
    }

    fail(message: string): void {
        this.status = 'error';
        this.phase = null;
        this.errorMessage = message;
    }

    cancel(): void {
        this.status = 'cancelled';
        this.phase = null;
        this.errorMessage = null;
    }

    reset(): void {
        this.status = 'idle';
        this.phase = null;
        this.errorMessage = null;
        this.usedCpuFallback = false;
        this.speakerCount = null;
    }
}
