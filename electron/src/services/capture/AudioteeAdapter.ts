import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import type { FileHandle } from 'fs/promises';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { shell } from 'electron';
import type { CaptureAdapter, CaptureAdapterEvents, CaptureAdapterStartOptions } from 'electron/src/services/capture/CaptureAdapter';
import type { WavFormat } from '../AudioPreprocessor';
import type { RecordingResult } from '../RecordingService';

export interface AudioteeAdapterConfig {
    chunkDurationMs?: number;
    mute?: boolean;
    includeProcesses?: number[];
    excludeProcesses?: number[];
    binaryPath?: string;
}

type AudioteeMessageType = 'metadata' | 'stream_start' | 'stream_stop' | 'info' | 'error' | 'debug';

interface AudioteeLogMessage {
    message_type: AudioteeMessageType;
    data: {
        message?: string;
        context?: Record<string, unknown>;
    };
}

export class AudioteeAdapter implements CaptureAdapter {
    public readonly id = 'audiotee';
    public readonly label = 'AudioTee';
    private readonly config: AudioteeAdapterConfig;
    private process: ChildProcessWithoutNullStreams | null = null;
    private exitPromise: Promise<void> | null = null;
    private writer: WavWriter | null = null;
    private events: CaptureAdapterEvents = {};
    private outputPath: string | null = null;
    private format: WavFormat | null = null;
    private totalFrames = 0;
    private bytesWritten = 0;
    private lastProgressAt = 0;
    private lastLevelAt = 0;
    private readonly progressIntervalMs = 300;
    private readonly levelIntervalMs = 250;
    private stderrBuffer = '';
    private hasError = false;
    private isStopping = false;
    private lastProcessError: string | null = null;

    constructor(config: AudioteeAdapterConfig = {}) {
        this.config = config;
    }

    public openScreenRecordingPreferences(): void {
        if (process.platform !== 'darwin') return;

        // AudioTee uses the "System Audio Recording" permission which is configured on this pane.
        void shell.openExternal(
            'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
        );
    }

    public async isAvailable(): Promise<boolean> {
        if (!this.isSupportedMacOS()) return false;

        try {
            await fsp.access(this.resolveBinaryPath());

            return true;
        } catch {
            return false;
        }
    }

    public async startRecording(options: CaptureAdapterStartOptions, events: CaptureAdapterEvents): Promise<void> {
        if (!this.isSupportedMacOS()) {
            throw new Error('AudioTee is supported only on macOS 14.2+.');
        }

        if (this.process) {
            throw new Error('Recording process is already running.');
        }

        const format = this.validateFormat(options.format);
        const binaryPath = this.resolveBinaryPath();

        try {
            await fsp.access(binaryPath);
        } catch {
            throw new Error(`AudioTee binary is not accessible: ${binaryPath}`);
        }

        this.events = events;
        this.outputPath = options.outputPath;
        this.format = format;
        this.totalFrames = 0;
        this.bytesWritten = 0;
        this.lastProgressAt = 0;
        this.lastLevelAt = 0;
        this.stderrBuffer = '';
        this.hasError = false;
        this.isStopping = false;
        this.lastProcessError = null;

        await fsp.mkdir(path.dirname(options.outputPath), { recursive: true });

        const writer = await WavWriter.create(options.outputPath, format);
        const args = this.buildArgs(format);
        const proc = spawn(binaryPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });

        this.writer = writer;
        this.process = proc;
        this.exitPromise = this.createExitPromise(proc);

        proc.stdout?.on('data', this.handleStdout);
        proc.stderr?.setEncoding('utf8');
        proc.stderr?.on('data', this.handleStderr);
    }

    public async stopRecording(): Promise<RecordingResult> {
        if (!this.outputPath || !this.format) {
            throw new Error('Recording process is not running.');
        }

        const proc = this.process;
        const exitPromise = this.exitPromise;
        const writer = this.writer;
        const outputPath = this.outputPath;
        const format = this.format;

        this.isStopping = true;

        if (proc) {
            try {
                proc.kill('SIGTERM');
            } catch {
                // ignore stop errors
            }
        }

        const killTimeout = proc
            ? setTimeout(() => {
                if (this.process === proc) {
                    try {
                        proc.kill('SIGKILL');
                    } catch {
                        // ignore kill errors
                    }
                }
            }, 5000)
            : null;

        if (exitPromise) {
            try {
                await exitPromise;
            } catch {
                // ignore exit errors on stop
            }
        }

        if (killTimeout) {
            clearTimeout(killTimeout);
        }

        if (writer) {
            await writer.finalize();
        }

        const durationMs = format.sampleRateHz > 0
            ? Math.round((this.totalFrames / format.sampleRateHz) * 1000)
            : undefined;

        this.resetState();

        return {
            filePath: outputPath,
            format,
            durationMs,
            bytesWritten: this.bytesWritten,
        };
    }

    private isSupportedMacOS(): boolean {
        if (process.platform !== 'darwin') return false;

        const [majorStr, minorStr] = os.release().split('.');
        const major = Number(majorStr);
        const minor = Number(minorStr);

        if (!Number.isFinite(major)) return true;
        if (major > 23) return true;
        if (major < 23) return false;

        return Number.isFinite(minor) ? minor >= 2 : true;
    }

    private resolveBinaryPath(): string {
        if (this.config.binaryPath) return this.config.binaryPath;

        return path.resolve(process.cwd(), 'node_modules', 'audiotee', 'bin', 'audiotee');
    }

    private buildArgs(format: WavFormat): string[] {
        const args: string[] = ['--sample-rate', String(format.sampleRateHz)];

        if (this.config.chunkDurationMs !== undefined) {
            args.push('--chunk-duration', String(this.config.chunkDurationMs / 1000));
        }

        if (this.config.mute) {
            args.push('--mute');
        }

        if (this.config.includeProcesses?.length) {
            args.push('--include-processes', ...this.config.includeProcesses.map((pid) => String(pid)));
        }

        if (this.config.excludeProcesses?.length) {
            args.push('--exclude-processes', ...this.config.excludeProcesses.map((pid) => String(pid)));
        }

        return args;
    }

    private validateFormat(format: WavFormat): WavFormat {
        if (format.codec !== 'pcm_s16le') {
            throw new Error(`AudioTee supports only pcm_s16le, got ${format.codec}.`);
        }

        if (format.bitDepth !== 16) {
            throw new Error(`AudioTee supports only 16-bit PCM, got ${format.bitDepth}.`);
        }

        if (format.channels !== 1) {
            throw new Error('AudioTee outputs mono audio only.');
        }

        if (format.sampleRateHz <= 0) {
            throw new Error('AudioTee requires a valid sample rate.');
        }

        return format;
    }

    private createExitPromise(proc: ChildProcessWithoutNullStreams): Promise<void> {
        return new Promise((resolve, reject) => {
            let settled = false;
            const settle = (error?: Error): void => {
                if (settled) return;
                settled = true;
                this.process = null;
                this.exitPromise = null;
                this.isStopping = false;
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            };

            proc.on('error', (error) => {
                this.reportError(error);
                settle(error);
            });

            proc.on('close', (code, signal) => {
                const error = this.buildExitError(code, signal);

                if (error && !this.hasError) {
                    this.reportError(error);
                    settle(error);

                    return;
                }

                settle();
            });
        });
    }

    private buildExitError(code: number | null, signal: NodeJS.Signals | null): Error | null {
        const stopped = this.isStopping;
        const exitCode = code ?? 0;

        if (stopped) return null;
        if (exitCode === 0 && !signal) return null;

        const details: string[] = [];

        if (code !== null) details.push(`code ${code}`);
        if (signal) details.push(`signal ${signal}`);
        const stderr = this.stderrBuffer.trim();

        if (stderr) details.push(`stderr: ${stderr}`);

        const base = this.lastProcessError ?? 'AudioTee process exited unexpectedly.';
        const suffix = details.length ? ` Details: ${details.join(', ')}` : '';

        return new Error(`${base}${suffix}`);
    }

    private reportError(error: Error): void {
        if (this.hasError) return;

        this.hasError = true;
        this.events.onError?.(error);
    }

    private readonly handleStdout = (chunk: unknown): void => {
        if (!Buffer.isBuffer(chunk)) return;

        this.handleAudioData(chunk);
    };

    private readonly handleStderr = (chunk: unknown): void => {
        const text = this.normalizeChunk(chunk);

        if (!text) return;

        this.stderrBuffer += text;

        let lineBreakIndex = this.stderrBuffer.indexOf('\n');

        while (lineBreakIndex !== -1) {
            const line = this.stderrBuffer.slice(0, lineBreakIndex).trim();

            this.stderrBuffer = this.stderrBuffer.slice(lineBreakIndex + 1);
            lineBreakIndex = this.stderrBuffer.indexOf('\n');

            if (!line) continue;

            this.handleLogLine(line);
        }

        if (this.stderrBuffer.length > 8000) {
            this.stderrBuffer = this.stderrBuffer.slice(-4000);
        }
    };

    private handleLogLine(line: string): void {
        let message: AudioteeLogMessage;

        try {
            message = JSON.parse(line) as AudioteeLogMessage;
        } catch {
            return;
        }

        if (message.message_type === 'debug' || message.message_type === 'info') {
            // Keep this in main process output for dev debugging (TCC issues are often visible here).
            console.log(`[audiotee:${message.message_type}]`, message.data?.message ?? '');
        }

        if (message.message_type === 'error') {
            const errorMessage = message.data?.message ?? 'AudioTee error.';

            this.lastProcessError = errorMessage;
            this.reportError(new Error(errorMessage));
        }
    }

    private normalizeChunk(chunk: unknown): string {
        if (typeof chunk === 'string') return chunk;
        if (Buffer.isBuffer(chunk)) return chunk.toString('utf8');

        return '';
    }

    private handleAudioData(data: Buffer): void {
        if (!this.writer || !this.format) return;
        if (!data.length) return;

        void this.writer.append(data).catch((error) => {
            this.reportError(error instanceof Error ? error : new Error(String(error)));
        });

        this.bytesWritten += data.length;
        const bytesPerFrame = this.format.channels * (this.format.bitDepth / 8);
        const frames = bytesPerFrame > 0 ? Math.floor(data.length / bytesPerFrame) : 0;

        this.totalFrames += frames;

        const now = Date.now();

        if (this.events.onProgress && now - this.lastProgressAt >= this.progressIntervalMs) {
            this.lastProgressAt = now;
            const durationMs = this.format.sampleRateHz > 0
                ? Math.round((this.totalFrames / this.format.sampleRateHz) * 1000)
                : 0;

            this.events.onProgress({ durationMs, bytesWritten: this.bytesWritten });
        }

        if (this.events.onLevel && now - this.lastLevelAt >= this.levelIntervalMs) {
            this.lastLevelAt = now;
            this.events.onLevel(this.computeLevel(data));
        }
    }

    private computeLevel(data: Buffer): { rms: number; peak: number; clipped: boolean } {
        let sumSquares = 0;
        let peak = 0;
        let clipped = false;
        let samples = 0;

        for (let i = 0; i + 1 < data.length; i += 2) {
            const sample = data.readInt16LE(i);
            const absValue = Math.abs(sample);

            if (absValue >= 32767) {
                clipped = true;
            }

            if (absValue > peak) {
                peak = absValue;
            }

            sumSquares += sample * sample;
            samples += 1;
        }

        if (samples === 0) {
            return { rms: 0, peak: 0, clipped: false };
        }

        const rms = Math.sqrt(sumSquares / samples) / 32768;
        const peakNorm = peak / 32768;

        return { rms, peak: peakNorm, clipped };
    }

    private resetState(): void {
        this.process = null;
        this.exitPromise = null;
        this.writer = null;
        this.events = {};
        this.outputPath = null;
        this.format = null;
        this.totalFrames = 0;
        this.bytesWritten = 0;
        this.lastProgressAt = 0;
        this.lastLevelAt = 0;
        this.stderrBuffer = '';
        this.hasError = false;
        this.isStopping = false;
        this.lastProcessError = null;
    }
}

class WavWriter {
    private readonly filePath: string;
    private readonly format: WavFormat;
    private handle: FileHandle | null = null;
    private bytesWritten = 0;
    private writePromise: Promise<void> = Promise.resolve();

    private constructor(filePath: string, format: WavFormat) {
        this.filePath = filePath;
        this.format = format;
    }

    public static async create(filePath: string, format: WavFormat): Promise<WavWriter> {
        const writer = new WavWriter(filePath, format);

        await writer.initialize();

        return writer;
    }

    public async append(data: Buffer): Promise<void> {
        if (!this.handle) return;
        if (data.length === 0) return;

        this.writePromise = this.writePromise.then(async () => {
            if (!this.handle) return;
            await this.handle.write(data, 0, data.length, this.headerSize() + this.bytesWritten);
            this.bytesWritten += data.length;
        });

        await this.writePromise;
    }

    public async finalize(): Promise<void> {
        if (!this.handle) return;

        await this.writePromise;

        const header = this.buildHeader(this.bytesWritten);

        await this.handle.write(header, 0, header.length, 0);
        await this.handle.close();
        this.handle = null;
    }

    private async initialize(): Promise<void> {
        this.handle = await fsp.open(this.filePath, 'w');
        const header = this.buildHeader(0);

        await this.handle.write(header, 0, header.length, 0);
    }

    private headerSize(): number {
        return 44;
    }

    private buildHeader(dataSize: number): Buffer {
        const buffer = Buffer.alloc(this.headerSize());
        const byteRate = this.format.sampleRateHz * this.format.channels * (this.format.bitDepth / 8);
        const blockAlign = this.format.channels * (this.format.bitDepth / 8);

        buffer.write('RIFF', 0);
        buffer.writeUInt32LE(36 + dataSize, 4);
        buffer.write('WAVE', 8);
        buffer.write('fmt ', 12);
        buffer.writeUInt32LE(16, 16);
        buffer.writeUInt16LE(1, 20);
        buffer.writeUInt16LE(this.format.channels, 22);
        buffer.writeUInt32LE(this.format.sampleRateHz, 24);
        buffer.writeUInt32LE(byteRate, 28);
        buffer.writeUInt16LE(blockAlign, 32);
        buffer.writeUInt16LE(this.format.bitDepth, 34);
        buffer.write('data', 36);
        buffer.writeUInt32LE(dataSize, 40);

        return buffer;
    }
}
