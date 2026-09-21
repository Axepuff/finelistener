import type { RecoverableRecording } from 'electron/src/types/recordingArchive';
import type { SessionDetails } from 'electron/src/types/sessions';
import { makeAutoObservable, runInAction } from 'mobx';
import type { RendererAdapter } from './rendererAdapter';
import type { ForegroundOperationStore } from './foregroundOperationStore';

export class RecordingRecoveryStore {
    items: RecoverableRecording[] = [];
    isLoading = false;
    error: string | null = null;
    activeRecordingId: string | null = null;
    warningAgeMs = 14 * 24 * 60 * 60 * 1000;
    private requestId = 0;

    constructor(
        private readonly adapter: RendererAdapter | null,
        private readonly operations: ForegroundOperationStore,
        private readonly onRecovered: (session: SessionDetails) => void,
    ) {
        makeAutoObservable<this, 'adapter' | 'operations' | 'onRecovered' | 'requestId'>(this, {
            adapter: false, operations: false, onRecovered: false, requestId: false,
        }, { autoBind: true });
    }

    get hasItems(): boolean { return this.items.length > 0; }

    async refresh(): Promise<void> {
        if (!this.adapter) return;
        const requestId = ++this.requestId;
        this.isLoading = true; this.error = null;
        try {
            const [items, warningDays] = await Promise.all([
                this.adapter.listRecoverableRecordings(),
                this.adapter.getUiPreference('recordingRecoveryWarningDays'),
            ]);
            if (requestId !== this.requestId) return;
            runInAction(() => { this.items = items; this.warningAgeMs = warningDays * 24 * 60 * 60 * 1000; });
        } catch (error) {
            console.error('Failed to load recoverable recordings', error);
            if (requestId === this.requestId) runInAction(() => { this.error = 'Could not load unfinished recordings.'; });
        } finally {
            if (requestId === this.requestId) runInAction(() => { this.isLoading = false; });
        }
    }

    async recover(recordingId: string): Promise<void> {
        if (!this.adapter || this.activeRecordingId) return;
        const operation = this.operations.begin('recovering-recording');
        if (!operation) { this.error = 'Another workspace operation is already running.'; return; }
        this.activeRecordingId = recordingId; this.error = null;
        try {
            const result = await this.adapter.recoverRecording(recordingId);
            runInAction(() => {
                this.items = this.items.filter((item) => item.recordingId !== recordingId);
                this.onRecovered(result.session);
            });
        } catch (error) {
            console.error('Failed to recover recording', error);
            runInAction(() => { this.error = 'Could not recover the recording.'; });
        } finally { runInAction(() => { this.activeRecordingId = null; this.operations.finish(operation); }); }
    }

    async discard(recordingId: string): Promise<void> {
        if (!this.adapter || this.activeRecordingId || this.operations.isBusy) return;
        this.activeRecordingId = recordingId; this.error = null;
        try {
            await this.adapter.discardRecording(recordingId);
            runInAction(() => { this.items = this.items.filter((item) => item.recordingId !== recordingId); });
        } catch (error) {
            console.error('Failed to delete recoverable recording', error);
            runInAction(() => { this.error = 'Could not delete the unfinished recording.'; });
        } finally { runInAction(() => { this.activeRecordingId = null; }); }
    }

    dispose(): void { this.requestId += 1; }
}
