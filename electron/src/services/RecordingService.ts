import { atom, createStore, type Atom } from 'jotai/vanilla';
import type { CaptureAdapter, RecordingSourceKind, RecordingSources } from './capture/CaptureAdapter';
import { DEFAULT_WAV_FORMAT, type WavFormat } from './AudioPreprocessor';
import { RecordingArchive } from './RecordingArchive';
import type { FinalizeRecordingResult, RecordingSessionInfo } from '../types/recordingArchive';

export interface RecordingLevel { source?: RecordingSourceKind; rms: number; peak: number; clipped: boolean }
export interface RecordingProgress { durationMs: number; bytesWritten?: number; sourceFailures?: RecordingSourceFailure[] }
export interface RecordingSourceFailure { source: RecordingSourceKind; message: string }
/** Internal capture-adapter value. It must never cross the preload boundary. */
export interface RecordingTrack { source: RecordingSourceKind; filePath: string; durationMs?: number; startOffsetMs?: number; failure?: string }
/** Internal capture-adapter value. It must never cross the preload boundary. */
export interface RecordingResult {
    filePath: string; format: WavFormat; durationMs?: number; bytesWritten?: number;
    tracks?: RecordingTrack[]; sourceFailures?: RecordingSourceFailure[];
}
interface ActiveRecording extends RecordingSessionInfo { outputPath: string; format: WavFormat }
export type RecordingState = 'idle' | 'starting' | 'recording' | 'stopping' | 'error';
export interface RecordingServiceCallbacks {
    onStateChange?: (state: RecordingState) => void;
    onProgress?: (progress: RecordingProgress) => void;
    onLevel?: (level: RecordingLevel) => void;
    onError?: (error: Error) => void;
    onFinished?: (result: FinalizeRecordingResult) => void;
}
export interface RecordingServiceConfig { defaultFormat?: WavFormat; archive?: RecordingArchive }
export interface RecordingStartOptions { deviceId?: string; sources?: RecordingSources }

export class RecordingService {
    private readonly archive: RecordingArchive;
    private readonly defaultFormat: WavFormat;
    private readonly store = createStore();
    private readonly atoms = {
        state: atom<RecordingState>('idle'), session: atom<ActiveRecording | null>(null),
        lastResult: atom<FinalizeRecordingResult | null>(null), lastError: atom<Error | null>(null),
        startInFlight: atom(false), stopInFlight: atom(false), stopRequested: atom(false),
    };

    constructor(private readonly adapter: CaptureAdapter, private readonly callbacks: RecordingServiceCallbacks = {}, config: RecordingServiceConfig = {}) {
        this.archive = config.archive ?? new RecordingArchive();
        this.defaultFormat = config.defaultFormat ?? { ...DEFAULT_WAV_FORMAT };
        this.store.sub(this.atoms.state, () => this.callbacks.onStateChange?.(this.store.get(this.atoms.state)));
    }

    public getState(): RecordingState { return this.store.get(this.atoms.state); }
    public getCurrentSession(): RecordingSessionInfo | null {
        const session = this.store.get(this.atoms.session);
        return session ? { recordingId: session.recordingId, startedAt: session.startedAt } : null;
    }

    public async startRecording(options: RecordingStartOptions = {}): Promise<RecordingSessionInfo> {
        if (this.getState() !== 'idle') throw new Error('Recording is already in progress');
        if (options.sources && typeof options.sources.system !== 'string' && typeof options.sources.microphone !== 'string') {
            throw new Error('Select at least one recording source.');
        }
        this.setState('starting'); this.store.set(this.atoms.stopRequested, false);
        this.store.set(this.atoms.lastError, null); this.store.set(this.atoms.startInFlight, true);
        const format = { ...this.defaultFormat };
        let session: ActiveRecording;
        try {
            const prepared = await this.archive.prepareCapture(options.sources, format);
            session = { ...prepared, format };
            this.store.set(this.atoms.session, session); this.store.set(this.atoms.lastResult, null);
            await this.adapter.startRecording(
                { outputPath: session.outputPath, format, deviceId: options.deviceId, sources: options.sources },
                {
                    onLevel: (level) => { if (this.isCurrentSession(session.recordingId)) this.callbacks.onLevel?.(level); },
                    onProgress: (progress) => { if (this.isCurrentSession(session.recordingId)) this.callbacks.onProgress?.(progress); },
                    onError: (error) => { if (this.isCurrentSession(session.recordingId)) void this.handleAdapterError(error, session.recordingId); },
                    onFinished: (result) => { if (this.isCurrentSession(session.recordingId)) void this.finishCapture(session, result, true); },
                },
            );
            if (this.isCurrentSession(session.recordingId) && !this.store.get(this.atoms.stopRequested)) this.setState('recording');
            return { recordingId: session.recordingId, startedAt: session.startedAt };
        } catch (error) {
            const err = this.toError(error); this.store.set(this.atoms.lastError, err);
            this.store.set(this.atoms.session, null); this.setState('idle'); throw err;
        } finally { this.store.set(this.atoms.startInFlight, false); }
    }

    public async stopRecording(): Promise<FinalizeRecordingResult> {
        if (this.store.get(this.atoms.stopInFlight)) return this.waitForStopCompletion();
        if (this.getState() === 'starting') {
            this.store.set(this.atoms.stopRequested, true);
            await this.waitForAtom(this.atoms.startInFlight, (value) => !value);
        }
        if (this.getState() === 'idle') return this.getCompletedResult();
        const session = this.store.get(this.atoms.session);
        if (!session) return this.getCompletedResult();
        this.store.set(this.atoms.stopInFlight, true); this.setState('stopping');
        let capture: RecordingResult;
        try { capture = await this.adapter.stopRecording(); }
        catch (error) {
            const err = this.toError(error); this.store.set(this.atoms.lastError, err);
            this.setState('error'); this.callbacks.onError?.(err); this.store.set(this.atoms.stopInFlight, false); throw err;
        }
        try { return await this.completeCapture(session, capture); }
        catch (error) {
            const err = this.toError(error); this.store.set(this.atoms.lastError, err);
            this.store.set(this.atoms.session, null); this.setState('idle'); this.callbacks.onError?.(err); throw err;
        } finally { this.store.set(this.atoms.stopInFlight, false); }
    }

    private async finishCapture(session: ActiveRecording, capture: RecordingResult, notify: boolean): Promise<void> {
        if (this.store.get(this.atoms.stopInFlight)) return;
        this.store.set(this.atoms.stopInFlight, true); this.setState('stopping');
        try { const result = await this.completeCapture(session, capture); if (notify) this.callbacks.onFinished?.(result); }
        catch (error) {
            const err = this.toError(error); this.store.set(this.atoms.lastError, err);
            this.store.set(this.atoms.session, null); this.setState('idle'); this.callbacks.onError?.(err);
        } finally { this.store.set(this.atoms.stopInFlight, false); }
    }

    private async completeCapture(session: ActiveRecording, capture: RecordingResult): Promise<FinalizeRecordingResult> {
        await this.archive.registerCaptureResult(session.recordingId, capture);
        const result = await this.archive.finalize(session.recordingId);
        this.store.set(this.atoms.lastResult, result); this.store.set(this.atoms.lastError, null);
        if (this.isCurrentSession(session.recordingId)) this.store.set(this.atoms.session, null);
        this.setState('idle'); return result;
    }

    private async handleAdapterError(error: Error, recordingId: string): Promise<void> {
        if (!this.isCurrentSession(recordingId)) return;
        this.callbacks.onError?.(error);
        if (this.store.get(this.atoms.stopInFlight)) return;
        const session = this.store.get(this.atoms.session); if (!session) return;
        this.store.set(this.atoms.stopInFlight, true); this.setState('stopping');
        try { const result = await this.completeCapture(session, await this.adapter.stopRecording()); this.callbacks.onFinished?.(result); }
        catch (cleanupError) {
            const err = this.toError(cleanupError); console.error('Recording cleanup failed', err);
            this.store.set(this.atoms.lastError, err); this.store.set(this.atoms.session, null); this.setState('idle');
        } finally { this.store.set(this.atoms.stopInFlight, false); }
    }

    private getCompletedResult(): FinalizeRecordingResult {
        const result = this.store.get(this.atoms.lastResult); if (result) return result;
        const error = this.store.get(this.atoms.lastError); if (error) throw error;
        throw new Error('Recording is not active');
    }
    private setState(state: RecordingState): void { if (this.store.get(this.atoms.state) !== state) this.store.set(this.atoms.state, state); }
    private isCurrentSession(id: string): boolean { return this.store.get(this.atoms.session)?.recordingId === id; }
    private toError(error: unknown): Error { return error instanceof Error ? error : new Error(String(error)); }
    private async waitForStopCompletion(): Promise<FinalizeRecordingResult> { await this.waitForAtom(this.atoms.stopInFlight, (value) => !value); return this.getCompletedResult(); }
    private waitForAtom<T>(atomRef: Atom<T>, predicate: (value: T) => boolean): Promise<T> {
        const current = this.store.get(atomRef); if (predicate(current)) return Promise.resolve(current);
        return new Promise<T>((resolve) => { const unsubscribe = this.store.sub(atomRef, () => { const next = this.store.get(atomRef); if (!predicate(next)) return; unsubscribe(); resolve(next); }); });
    }
}
