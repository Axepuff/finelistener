import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { app } from 'electron';
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

export interface CaptureAdapterStartOptions {
    outputPath: string;
    format: WavFormat;
}

export interface CaptureAdapterEvents {
    onLevel?: (level: RecordingLevel) => void;
    onProgress?: (progress: RecordingProgress) => void;
    onError?: (error: Error) => void;
}

export interface CaptureAdapter {
    readonly id: string;
    readonly label: string;
    isAvailable?: () => Promise<boolean>;
    startRecording(options: CaptureAdapterStartOptions, events: CaptureAdapterEvents): Promise<void>;
    stopRecording(): Promise<RecordingResult>;
}

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
}

export class RecordingService {
    private readonly adapter: CaptureAdapter;
    private readonly callbacks: RecordingServiceCallbacks;
    private readonly recordingsDir: string;
    private readonly defaultFormat: WavFormat;
    private state: RecordingState = 'idle';
    private currentSession: RecordingSession | null = null;
    private stopPromise: Promise<RecordingResult> | null = null;
    private lastResult: RecordingResult | null = null;

    constructor(
        adapter: CaptureAdapter,
        callbacks: RecordingServiceCallbacks = {},
        config: RecordingServiceConfig = {},
    ) {
        this.adapter = adapter;
        this.callbacks = callbacks;
        this.recordingsDir = config.recordingsDir ?? path.join(app.getPath('userData'), 'recordings');
        this.defaultFormat = config.defaultFormat ?? { ...DEFAULT_WAV_FORMAT };
    }

    public getState(): RecordingState {
        return this.state;
    }

    public getCurrentSession(): RecordingSession | null {
        return this.currentSession;
    }

    public async startRecording(options: RecordingStartOptions = {}): Promise<RecordingSession> {
        if (this.state !== 'idle') {
            throw new Error('Recording is already in progress');
        }

        this.setState('starting');

        const format: WavFormat = { ...this.defaultFormat, ...(options.format ?? {}) };

        await fs.mkdir(this.recordingsDir, { recursive: true });

        const outputPath = await this.resolveOutputPath(options.fileName);
        const sessionId = randomUUID();
        const session: RecordingSession = {
            sessionId,
            filePath: outputPath,
            format,
            startedAt: Date.now(),
        };

        this.currentSession = session;
        this.lastResult = null;
        this.stopPromise = null;

        try {
            await this.adapter.startRecording(
                { outputPath, format },
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

            this.setState('recording');

            return session;
        } catch (error) {
            if (this.isCurrentSession(sessionId)) {
                this.currentSession = null;
                this.stopPromise = null;
                this.setState('idle');
            }
            throw error;
        }
    }

    public async stopRecording(): Promise<RecordingResult> {
        if (this.stopPromise) {
            return this.stopPromise;
        }

        if (this.state === 'idle') {
            if (this.lastResult) {
                return this.lastResult;
            }
            throw new Error('Recording is not active');
        }

        const session = this.currentSession;

        if (!session) {
            if (this.lastResult) {
                return this.lastResult;
            }
            throw new Error('Recording session is not available');
        }

        this.setState('stopping');

        const sessionId = session.sessionId;
        const stopPromise = (async () => {
            try {
                const result = await this.adapter.stopRecording();

                if (!this.isCurrentSession(sessionId)) {
                    return result;
                }

                const finalized = this.attachSessionResult(result, session);

                this.lastResult = finalized;
                this.currentSession = null;
                this.setState('idle');

                return finalized;
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));

                if (this.isCurrentSession(sessionId)) {
                    this.setState('error');
                }
                this.callbacks.onError?.(err);
                throw err;
            }
        })();

        this.stopPromise = stopPromise;

        void stopPromise.finally(() => {
            if (this.stopPromise === stopPromise) {
                this.stopPromise = null;
            }
        });

        return stopPromise;
    }

    private setState(state: RecordingState): void {
        if (this.state === state) return;

        this.state = state;
        this.callbacks.onStateChange?.(state);
    }

    private isCurrentSession(sessionId: string): boolean {
        return this.currentSession?.sessionId === sessionId;
    }

    private async handleAdapterError(error: Error, sessionId: string): Promise<void> {
        if (!this.isCurrentSession(sessionId)) return;

        this.callbacks.onError?.(error);
        this.setState('error');

        const activeStopPromise = this.stopPromise ?? this.adapter.stopRecording();

        this.stopPromise ??= activeStopPromise;

        try {
            const result = await activeStopPromise;

            if (!this.isCurrentSession(sessionId)) {
                return;
            }

            const session = this.currentSession;

            this.currentSession = null;

            if (session) {
                this.lastResult = this.attachSessionResult(result, session);
            }

            this.setState('idle');
        } catch {
            // ignore cleanup errors
        } finally {
            if (this.stopPromise === activeStopPromise) {
                this.stopPromise = null;
            }
        }
    }

    private attachSessionResult(result: RecordingResult, session: RecordingSession): RecordingResult {
        return {
            ...result,
            durationMs: result.durationMs ?? Math.max(0, Date.now() - session.startedAt),
            sessionId: session.sessionId,
        };
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
