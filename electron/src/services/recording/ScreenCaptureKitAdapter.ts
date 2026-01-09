import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { app, systemPreferences, shell } from 'electron';
import type { WavFormat } from '../AudioPreprocessor';
import type { CaptureAdapter, CaptureAdapterEvents, CaptureAdapterStartOptions, RecordingResult } from '../RecordingService';

export type ScreenRecordingPermissionStatus =
    | 'granted'
    | 'denied'
    | 'restricted'
    | 'not-determined'
    | 'unknown';

export interface ScreenCaptureKitAdapterConfig {
    helperPath?: string;
}

type HelperMessage =
    | { type: 'progress'; durationMs: number; bytesWritten?: number }
    | { type: 'level'; rms: number; peak: number; clipped?: boolean }
    | { type: 'error'; message: string }
    | { type: 'format'; sampleRateHz: number; channels: number; bitDepth: number; codec: string };

export class ScreenCaptureKitAdapter implements CaptureAdapter {
    public readonly id = 'screen-capture-kit';
    public readonly label = 'ScreenCaptureKit';
    private readonly helperPath: string | null;
    private process: ChildProcessWithoutNullStreams | null = null;
    private exitPromise: Promise<RecordingResult> | null = null;
    private outputPath: string | null = null;
    private format: WavFormat | null = null;
    private events: CaptureAdapterEvents = {};
    private stdoutBuffer = '';
    private stderrBuffer = '';
    private lastHelperError: string | null = null;

    constructor(config: ScreenCaptureKitAdapterConfig = {}) {
        this.helperPath = config.helperPath ??
        process.env.SCREENCAPTUREKIT_HELPER_PATH ??
        this.resolveDefaultHelperPath();
    }

    public async isAvailable(): Promise<boolean> {
        if (process.platform !== 'darwin') return false;
        if (!this.helperPath) return false;

        try {
            await fsp.access(this.helperPath);

            return true;
        } catch {
            return false;
        }
    }

    public getPermissionStatus(): ScreenRecordingPermissionStatus {
        if (process.platform !== 'darwin') return 'unknown';

        const status = systemPreferences.getMediaAccessStatus('screen');

        switch (status) {
            case 'granted':
            case 'denied':
            case 'restricted':
            case 'not-determined':
                return status;
            default:
                return 'unknown';
        }
    }

    public openScreenRecordingPreferences(): void {
        if (process.platform !== 'darwin') return;

        void shell.openExternal(
            'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
        );
    }

    public async startRecording(options: CaptureAdapterStartOptions, events: CaptureAdapterEvents): Promise<void> {
        if (process.platform !== 'darwin') {
            throw new Error('ScreenCaptureKit is supported only on macOS.');
        }

        if (this.process) {
            throw new Error('Recording process is already running.');
        }

        const helperPath = this.resolveHelperPath();

        try {
            await fsp.access(helperPath);
        } catch {
            throw new Error(`ScreenCaptureKit helper is not accessible: ${helperPath}`);
        }
        const permission = this.getPermissionStatus();

        if (permission === 'restricted') {
            throw new Error('Запись экрана запрещена политикой системы.');
        }

        this.events = events;
        this.outputPath = options.outputPath;
        this.format = options.format;
        this.stdoutBuffer = '';
        this.stderrBuffer = '';
        this.lastHelperError = null;

        const args = this.buildHelperArgs(options);
        const proc = spawn(helperPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });

        this.process = proc;
        this.exitPromise = this.createExitPromise(proc);

        proc.stdout?.setEncoding('utf8');
        proc.stdout?.on('data', this.handleStdout);

        proc.stderr?.setEncoding('utf8');
        proc.stderr?.on('data', this.handleStderr);
    }

    public async stopRecording(): Promise<RecordingResult> {
        if (!this.process || !this.exitPromise) {
            throw new Error('Recording process is not running.');
        }

        try {
            this.process.kill('SIGINT');
        } catch {
            // ignore stop errors
        }

        return this.exitPromise;
    }

    private resolveHelperPath(): string {
        if (!this.helperPath) {
            throw new Error('ScreenCaptureKit helper path is not configured.');
        }

        return this.helperPath;
    }

    private resolveDefaultHelperPath(): string | null {
        const appPath = app.getAppPath();
        const devCandidates = [
            path.resolve(appPath, 'resources', 'ScreenCaptureKitHelper'),
            path.resolve(appPath, 'resources', 'screencapturekit-helper', '.build', 'release', 'ScreenCaptureKitHelper'),
        ];
        const packagedCandidates = [path.resolve(process.resourcesPath, 'ScreenCaptureKitHelper')];
        const candidates = app.isPackaged ?
            packagedCandidates.concat(devCandidates) :
            devCandidates.concat(packagedCandidates);

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                console.log('HELPER есть');

                return candidate;
            }
        }

        return null;
    }

    private buildHelperArgs(options: CaptureAdapterStartOptions): string[] {
        return [
            '--output',
            options.outputPath,
            '--sample-rate',
            String(options.format.sampleRateHz),
            '--channels',
            String(options.format.channels),
            '--bit-depth',
            String(options.format.bitDepth),
            '--codec',
            options.format.codec,
        ];
    }

    private createExitPromise(proc: ChildProcessWithoutNullStreams): Promise<RecordingResult> {
        return new Promise((resolve, reject) => {
            let settled = false;
            const finalize = () => {
                this.process = null;
                this.exitPromise = null;
                this.events = {};
                this.outputPath = null;
                this.format = null;
                this.lastHelperError = null;
            };
            const rejectOnce = (error: Error, reportError: boolean): void => {
                if (settled) return;
                settled = true;
                if (reportError) {
                    this.events.onError?.(error);
                }
                finalize();
                reject(error);
            };
            const resolveOnce = (result: RecordingResult): void => {
                if (settled) return;
                settled = true;
                finalize();
                resolve(result);
            };

            proc.on('error', (error) => {
                rejectOnce(error, true);
            });

            proc.on('close', (code, signal) => {
                const outputPath = this.outputPath;
                const format = this.format;
                const stderr = this.stderrBuffer.trim();
                const helperError = this.lastHelperError;

                if (!outputPath || !format) {
                    rejectOnce(new Error('Recording output is missing.'), true);

                    return;
                }

                if (code !== 0 || signal) {
                    const details = this.formatExitDetails(code, signal, stderr);
                    const message = helperError
                        ? `${helperError}${details ? ` ${details}` : ''}`
                        : `ScreenCaptureKit helper exited.${details}`;
                    const error = new Error(message);

                    rejectOnce(error, !helperError);

                    return;
                }

                resolveOnce({ filePath: outputPath, format });
            });
        });
    }

    private readonly handleStdout = (chunk: unknown): void => {
        const text = this.normalizeChunk(chunk);

        if (!text) return;

        this.stdoutBuffer += text;

        let lineBreakIndex = this.stdoutBuffer.indexOf('\n');

        while (lineBreakIndex !== -1) {
            const line = this.stdoutBuffer.slice(0, lineBreakIndex).trim();

            this.stdoutBuffer = this.stdoutBuffer.slice(lineBreakIndex + 1);
            lineBreakIndex = this.stdoutBuffer.indexOf('\n');

            if (!line) continue;

            this.handleHelperLine(line);
        }
    };

    private readonly handleStderr = (chunk: unknown): void => {
        const text = this.normalizeChunk(chunk);

        if (!text) return;

        this.stderrBuffer += text;
        if (this.stderrBuffer.length > 8000) {
            this.stderrBuffer = this.stderrBuffer.slice(-4000);
        }
    };

    private handleHelperLine(line: string): void {
        let message: HelperMessage;

        try {
            message = JSON.parse(line) as HelperMessage;
        } catch {
            return;
        }

        switch (message.type) {
            case 'progress':
                this.events.onProgress?.({
                    durationMs: message.durationMs,
                    bytesWritten: message.bytesWritten,
                });

                return;
            case 'level':
                this.events.onLevel?.({
                    rms: message.rms,
                    peak: message.peak,
                    clipped: Boolean(message.clipped),
                });

                return;
            case 'error':
                this.lastHelperError = message.message;
                this.events.onError?.(new Error(message.message));

                return;
            case 'format':
                this.format = {
                    sampleRateHz: message.sampleRateHz,
                    channels: message.channels,
                    bitDepth: message.bitDepth,
                    codec: message.codec,
                };

                return;
            default:
                return;
        }
    }

    private normalizeChunk(chunk: unknown): string {
        if (typeof chunk === 'string') return chunk;
        if (Buffer.isBuffer(chunk)) return chunk.toString('utf8');

        return '';
    }

    private formatExitDetails(code: number | null, signal: NodeJS.Signals | null, stderr: string): string {
        const parts: string[] = [];

        if (code !== null) parts.push(`code ${code}`);
        if (signal) parts.push(`signal ${signal}`);
        if (stderr) parts.push(`stderr: ${stderr}`);

        return parts.length ? ` Details: ${parts.join(', ')}` : '';
    }
}
