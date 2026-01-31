import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { app } from 'electron';
import type { CaptureAdapter } from 'electron/src/services/capture/CaptureAdapter';
import { atom, createStore, type Atom } from 'jotai/vanilla';
import { DEFAULT_WAV_FORMAT, type WavFormat } from './AudioPreprocessor';

export interface RecordingLevel {
    rms: number;
    peak: number;
    clipped: boolean;
}

export interface RecordingProgress {
    durationMs: number;
    bytesWritten?: number;
}

export interface RecordingSession {
    sessionId: string;
    filePath: string;
    format: WavFormat;
    startedAt: number;
}

export interface RecordingResult {
    filePath: string;
    format: WavFormat;
    durationMs?: number;
    bytesWritten?: number;
    sessionId?: string;
}

export type RecordingState = 'idle' | 'starting' | 'recording' | 'stopping' | 'error';

export interface RecordingServiceCallbacks {
    onStateChange?: (state: RecordingState) => void;
    onProgress?: (progress: RecordingProgress) => void;
    onLevel?: (level: RecordingLevel) => void;
    onError?: (error: Error) => void;
}

export interface RecordingServiceConfig {
    recordingsDir?: string;
    defaultFormat?: WavFormat;
}

export interface RecordingStartOptions {
    fileName?: string;
    format?: Partial<WavFormat>;
    deviceId?: string;
}

export class RecordingService {
    private readonly adapter: CaptureAdapter;
    private readonly callbacks: RecordingServiceCallbacks;
    private readonly recordingsDir: string;
    private readonly defaultFormat: WavFormat;
    private readonly store = createStore();
    private readonly atoms = {
        state: atom<RecordingState>('idle'),
        session: atom<RecordingSession | null>(null),
        lastResult: atom<RecordingResult | null>(null),
        lastError: atom<Error | null>(null),
        startInFlight: atom(false),
        stopInFlight: atom(false),
        stopRequested: atom(false),
    };

    constructor(
        adapter: CaptureAdapter,
        callbacks: RecordingServiceCallbacks = {},
        config: RecordingServiceConfig = {},
    ) {
        this.adapter = adapter;
        this.callbacks = callbacks;
        this.recordingsDir = config.recordingsDir ?? path.join(app.getPath('userData'), 'recordings');
        this.defaultFormat = config.defaultFormat ?? { ...DEFAULT_WAV_FORMAT };

        this.store.sub(this.atoms.state, () => {
            this.callbacks.onStateChange?.(this.store.get(this.atoms.state));
        });
    }

    public getState(): RecordingState {
        return this.store.get(this.atoms.state);
    }

    public getCurrentSession(): RecordingSession | null {
        return this.store.get(this.atoms.session);
    }

    public async startRecording(options: RecordingStartOptions = {}): Promise<RecordingSession> {
        if (this.getState() !== 'idle') {
            throw new Error('Recording is already in progress');
        }

        this.setState('starting');
        this.store.set(this.atoms.stopRequested, false);
        this.store.set(this.atoms.lastError, null);
        this.store.set(this.atoms.startInFlight, true);

        const format: WavFormat = { ...this.defaultFormat, ...(options.format ?? {}) };
        const deviceId = options.deviceId;

        await fs.mkdir(this.recordingsDir, { recursive: true });

        const outputPath = await this.resolveOutputPath(options.fileName);
        const sessionId = randomUUID();
        const session: RecordingSession = {
            sessionId,
            filePath: outputPath,
            format,
            startedAt: Date.now(),
        };

        this.store.set(this.atoms.session, session);
        this.store.set(this.atoms.lastResult, null);

        try {
            await this.adapter.startRecording(
                { outputPath, format, deviceId },
                {
                    onLevel: (level) => {
                        if (!this.isCurrentSession(sessionId)) return;
                        this.callbacks.onLevel?.(level);
                    },
                    onProgress: (progress) => {
                        if (!this.isCurrentSession(sessionId)) return;
                        this.callbacks.onProgress?.(progress);
                    },
                    onError: (error) => {
                        if (!this.isCurrentSession(sessionId)) return;
                        void this.handleAdapterError(error, sessionId);
                    },
                },
            );

            if (!this.isCurrentSession(sessionId)) {
                return session;
            }

            if (this.store.get(this.atoms.stopRequested)) {
                return session;
            }

            this.setState('recording');

            return session;
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));

            if (this.isCurrentSession(sessionId)) {
                this.store.set(this.atoms.session, null);
                this.setState('idle');
            }

            this.store.set(this.atoms.lastError, err);
            throw err;
        } finally {
            this.store.set(this.atoms.startInFlight, false);
        }
    }

    public async stopRecording(): Promise<RecordingResult> {
        if (this.store.get(this.atoms.stopInFlight)) {
            return this.waitForStopCompletion();
        }

        if (this.getState() === 'starting') {
            this.store.set(this.atoms.stopRequested, true);

            await this.waitForAtom(this.atoms.startInFlight, (value) => !value);
        }

        if (this.getState() === 'idle') {
            const lastResult = this.store.get(this.atoms.lastResult);
            const lastError = this.store.get(this.atoms.lastError);

            if (lastResult) {
                return lastResult;
            }
            if (lastError) {
                throw lastError;
            }
            throw new Error('Recording is not active');
        }

        if (this.getState() === 'stopping') {
            return this.waitForStopCompletion();
        }

        const session = this.store.get(this.atoms.session);

        if (!session) {
            const lastResult = this.store.get(this.atoms.lastResult);
            const lastError = this.store.get(this.atoms.lastError);

            if (lastResult) {
                return lastResult;
            }
            if (lastError) {
                throw lastError;
            }
            throw new Error('Recording session is not available');
        }

        this.store.set(this.atoms.stopInFlight, true);
        this.setState('stopping');

        const sessionId = session.sessionId;

        try {
            const result = await this.adapter.stopRecording();

            if (!this.isCurrentSession(sessionId)) {
                return result;
            }

            const finalized = this.attachSessionResult(result, session);

            this.store.set(this.atoms.lastResult, finalized);
            this.store.set(this.atoms.session, null);
            this.store.set(this.atoms.lastError, null);
            this.setState('idle');

            return finalized;
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));

            if (this.isCurrentSession(sessionId)) {
                this.setState('error');
            }
            this.store.set(this.atoms.lastError, err);
            this.callbacks.onError?.(err);
            throw err;
        } finally {
            this.store.set(this.atoms.stopInFlight, false);
        }
    }

    private setState(state: RecordingState): void {
        if (this.store.get(this.atoms.state) === state) return;

        this.store.set(this.atoms.state, state);
    }

    private isCurrentSession(sessionId: string): boolean {
        return this.store.get(this.atoms.session)?.sessionId === sessionId;
    }

    private async handleAdapterError(error: Error, sessionId: string): Promise<void> {
        if (!this.isCurrentSession(sessionId)) return;

        this.store.set(this.atoms.lastError, error);
        this.callbacks.onError?.(error);
        this.setState('error');

        if (this.store.get(this.atoms.stopInFlight)) {
            try {
                await this.waitForStopCompletion();
            } catch {
                // ignore cleanup errors
            }

            return;
        }

        this.store.set(this.atoms.stopInFlight, true);

        try {
            const result = await this.adapter.stopRecording();

            if (!this.isCurrentSession(sessionId)) {
                return;
            }

            const session = this.store.get(this.atoms.session);

            this.store.set(this.atoms.session, null);

            if (session) {
                this.store.set(this.atoms.lastResult, this.attachSessionResult(result, session));
            }

            this.store.set(this.atoms.lastError, null);
            this.setState('idle');
        } catch {
            // ignore cleanup errors
        } finally {
            this.store.set(this.atoms.stopInFlight, false);
        }
    }

    private attachSessionResult(result: RecordingResult, session: RecordingSession): RecordingResult {
        return {
            ...result,
            durationMs: result.durationMs ?? Math.max(0, Date.now() - session.startedAt),
            sessionId: session.sessionId,
        };
    }

    private waitForAtom<T>(atomRef: Atom<T>, predicate: (value: T) => boolean): Promise<T> {
        const current = this.store.get(atomRef);

        if (predicate(current)) {
            return Promise.resolve(current);
        }

        return new Promise<T>((resolve) => {
            const unsubscribe = this.store.sub(atomRef, () => {
                const next = this.store.get(atomRef);

                if (!predicate(next)) return;

                unsubscribe();
                resolve(next);
            });
        });
    }

    private async waitForStopCompletion(): Promise<RecordingResult> {
        await this.waitForAtom(this.atoms.stopInFlight, (value) => !value);

        const lastResult = this.store.get(this.atoms.lastResult);
        const lastError = this.store.get(this.atoms.lastError);
        const state = this.getState();

        if (lastResult) {
            return lastResult;
        }

        if (lastError && state === 'error') {
            throw lastError;
        }

        if (lastError) {
            throw lastError;
        }

        throw new Error('Recording is not active');
    }

    private async resolveOutputPath(fileName?: string): Promise<string> {
        const baseName = this.normalizeFileName(fileName);
        const basePath = path.join(this.recordingsDir, baseName);

        if (!fileName) {
            return basePath;
        }

        return this.ensureUniquePath(basePath);
    }

    private async ensureUniquePath(filePath: string): Promise<string> {
        if (!(await this.pathExists(filePath))) {
            return filePath;
        }

        const dirName = path.dirname(filePath);
        const ext = path.extname(filePath);
        const base = path.basename(filePath, ext);

        for (let attempt = 1; attempt < 10000; attempt += 1) {
            const candidate = path.join(dirName, `${base}-${attempt}${ext}`);

            if (!(await this.pathExists(candidate))) {
                return candidate;
            }
        }

        throw new Error('Failed to generate unique recording filename');
    }

    private async pathExists(filePath: string): Promise<boolean> {
        try {
            await fs.access(filePath);

            return true;
        } catch {
            return false;
        }
    }

    private normalizeFileName(fileName?: string): string {
        const base = fileName?.trim() || `recording-${Date.now()}-${randomUUID()}`;
        const sanitized = base.replace(/[^\w.-]/g, '_');

        return sanitized.toLowerCase().endsWith('.wav') ? sanitized : `${sanitized}.wav`;
    }
}
