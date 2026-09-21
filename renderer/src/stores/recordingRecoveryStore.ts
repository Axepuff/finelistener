import type { RecoverableRecording } from 'electron/src/types/recordingArchive';
import type { SessionDetails } from 'electron/src/types/sessions';
import { makeAutoObservable, runInAction } from 'mobx';
import type { RendererAdapter } from './rendererAdapter';
import type { ForegroundOperationStore } from './foregroundOperationStore';

export class RecordingRecoveryStore {
    private itemsValue: RecoverableRecording[] = [];
    private isLoadingValue = false;
    private errorValue: string | null = null;
    private activeRecordingIdValue: string | null = null;
    private warningAgeMsValue = 14 * 24 * 60 * 60 * 1000;
    private requestId = 0;
    private lifecycleId = 0;
    private disposed = true;

    constructor(
        private readonly adapter: RendererAdapter | null,
        private readonly operations: ForegroundOperationStore,
        private readonly onRecovered: (session: SessionDetails) => void,
    ) {
        makeAutoObservable<this, 'adapter' | 'operations' | 'onRecovered' | 'requestId' | 'lifecycleId' | 'disposed'>(this, {
            adapter: false,
            operations: false,
            onRecovered: false,
            requestId: false,
            lifecycleId: false,
            disposed: false,
        }, { autoBind: true });
    }

    get items(): readonly RecoverableRecording[] { return this.itemsValue; }
    get isLoading(): boolean { return this.isLoadingValue; }
    get error(): string | null { return this.errorValue; }
    get activeRecordingId(): string | null { return this.activeRecordingIdValue; }
    get warningAgeMs(): number { return this.warningAgeMsValue; }
    get hasItems(): boolean { return this.itemsValue.length > 0; }

    initialize(): void {
        this.disposed = false;
        this.lifecycleId += 1;
        void this.refresh();
    }

    async refresh(): Promise<void> {
        if (!this.adapter || this.disposed) return;
        const requestId = ++this.requestId;
        const lifecycleId = this.lifecycleId;
        this.isLoadingValue = true;
        this.errorValue = null;
        try {
            const [items, warningDays] = await Promise.all([
                this.adapter.listRecoverableRecordings(),
                this.adapter.getUiPreference('recordingRecoveryWarningDays'),
            ]);
            if (!this.isCurrent(lifecycleId, requestId)) return;
            runInAction(() => {
                this.itemsValue = items;
                this.warningAgeMsValue = warningDays * 24 * 60 * 60 * 1000;
            });
        } catch (error) {
            console.error('Failed to load recoverable recordings', error);
            if (this.isCurrent(lifecycleId, requestId)) {
                runInAction(() => { this.errorValue = 'Could not load unfinished recordings.'; });
            }
        } finally {
            if (this.isCurrent(lifecycleId, requestId)) runInAction(() => { this.isLoadingValue = false; });
        }
    }

    async recover(recordingId: string): Promise<void> {
        if (!this.adapter || this.activeRecordingIdValue || this.disposed) return;
        const operation = this.operations.begin('recovering-recording');
        if (!operation) { this.errorValue = 'Another workspace operation is already running.'; return; }
        const lifecycleId = this.lifecycleId;
        this.activeRecordingIdValue = recordingId;
        this.errorValue = null;
        try {
            const result = await this.adapter.recoverRecording(recordingId);
            if (!this.isCurrent(lifecycleId) || !this.operations.owns(operation)) return;
            const session = await this.adapter.getSession(result.sessionId);
            if (!this.isCurrent(lifecycleId) || !this.operations.owns(operation)) return;
            runInAction(() => {
                this.itemsValue = this.itemsValue.filter((item) => item.recordingId !== recordingId);
                this.onRecovered(session);
            });
        } catch (error) {
            console.error('Failed to recover recording', error);
            if (this.isCurrent(lifecycleId)) {
                runInAction(() => { this.errorValue = 'Could not recover the recording.'; });
            }
        } finally {
            if (this.isCurrent(lifecycleId)) {
                runInAction(() => { this.activeRecordingIdValue = null; });
            }
            this.operations.finish(operation);
        }
    }

    async discard(recordingId: string): Promise<void> {
        if (!this.adapter || this.activeRecordingIdValue || this.disposed) return;
        const operation = this.operations.begin('discarding-recording');
        if (!operation) { this.errorValue = 'Another workspace operation is already running.'; return; }
        const lifecycleId = this.lifecycleId;
        this.activeRecordingIdValue = recordingId;
        this.errorValue = null;
        try {
            await this.adapter.discardRecording(recordingId);
            if (!this.isCurrent(lifecycleId) || !this.operations.owns(operation)) return;
            runInAction(() => { this.itemsValue = this.itemsValue.filter((item) => item.recordingId !== recordingId); });
        } catch (error) {
            console.error('Failed to delete recoverable recording', error);
            if (this.isCurrent(lifecycleId)) {
                runInAction(() => { this.errorValue = 'Could not delete the unfinished recording.'; });
            }
        } finally {
            if (this.isCurrent(lifecycleId)) {
                runInAction(() => { this.activeRecordingIdValue = null; });
            }
            this.operations.finish(operation);
        }
    }

    dispose(): void {
        this.disposed = true;
        this.lifecycleId += 1;
        this.requestId += 1;
        this.isLoadingValue = false;
        this.activeRecordingIdValue = null;
    }

    private isCurrent(lifecycleId: number, requestId?: number): boolean {
        return !this.disposed && lifecycleId === this.lifecycleId
            && (requestId === undefined || requestId === this.requestId);
    }
}
