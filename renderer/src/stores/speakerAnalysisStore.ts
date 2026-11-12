import type { SpeakerAnalysisProgressEvent, SpeakerAssetStatus, SpeakerCompute } from 'electron/src/types/transcription';
import { makeAutoObservable, runInAction } from 'mobx';
import type { RendererAdapter } from './rendererAdapter';
import { SPEAKER_ERROR_MESSAGES } from '../../../electron/src/types/transcription';

export const speakerErrorMessage = (error: unknown): string | undefined => error instanceof Error ?
    Object.entries(SPEAKER_ERROR_MESSAGES).find(([code]) => error.message === code || error.message.endsWith(`: ${code}`))?.[1] : undefined;

export class SpeakerAnalysisStore {
    enabled = true;

    compute: SpeakerCompute = 'auto';

    phase: SpeakerAnalysisProgressEvent['phase'] | null = null;

    downloadedBytes = 0;

    totalBytes = 0;

    percent: number | null = null;

    status: 'idle' | 'running' | 'success' | 'error' | 'cancelled' = 'idle';

    errorMessage: string | null = null;

    assets: SpeakerAssetStatus | null = null;

    private preferenceRequestId = 0;

    private computeRequestId = 0;

    private assetRequestId = 0;

    private disposed = false;

    constructor(private readonly adapter: RendererAdapter | null) {
        makeAutoObservable<this, 'adapter'>(this, { adapter: false }, { autoBind: true });
    }

    get computeOptions() {
        return [{ value: 'auto', label: 'Auto (GPU when available)' }, { value: 'cpu', label: 'CPU' },
            { value: 'gpu', label: this.assets?.gpuBackend ? `GPU (${this.assets.gpuBackend === 'metal' ? 'Metal' : 'Vulkan'})` : 'GPU',
                disabled: this.assets !== null && this.assets.gpuBackend === null }];
    }

    get componentReady(): boolean {
        return this.assets?.ready ?? false;
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
        const computeRequestId = ++this.computeRequestId;
        void this.adapter?.getUiPreference('speakerCompute').then((compute) => {
            if (this.disposed || computeRequestId !== this.computeRequestId) return;
            runInAction(() => { this.compute = compute; });
        }).catch((error: unknown) => { console.error('Failed to load speaker compute preference', error); });
        void this.refreshAssets();
    }

    dispose(): void {
        this.disposed = true;
        this.preferenceRequestId += 1;
        this.computeRequestId += 1;
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

    async setCompute(compute: string | null): Promise<void> {
        if (compute !== 'auto' && compute !== 'cpu' && compute !== 'gpu') return;
        this.computeRequestId += 1;
        this.compute = compute;
        try { await this.adapter?.setUiPreference('speakerCompute', compute); }
        catch (error) { console.error('Failed to save speaker compute preference', error); }
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
    }

    updateProgress(event: SpeakerAnalysisProgressEvent): void {
        if (this.status !== 'running') return;
        this.phase = event.phase;
        this.percent = event.percent !== undefined && Number.isFinite(event.percent) ?
            Math.max(0, Math.min(100, event.percent)) : null;
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
    }
}
