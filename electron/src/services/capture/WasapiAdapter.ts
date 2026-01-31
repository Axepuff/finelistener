import fs from 'fs';
import type { FileHandle } from 'fs/promises';
import fsp from 'fs/promises';
import path from 'path';
import {
    getActiveWindowProcessIds,
    getLoopbackBinaryPath,
    getProcessListBinaryPath,
    setExecutablesRoot,
    startAudioCapture,
    stopAudioCapture,
    type Window,
} from 'application-loopback';
import { app } from 'electron';
import type { WavFormat } from '../AudioPreprocessor';
import type { RecordingResult } from '../RecordingService';
import type { CaptureAdapter, CaptureAdapterEvents, CaptureAdapterStartOptions } from './CaptureAdapter';

export const WASAPI_WAV_FORMAT: WavFormat = {
    sampleRateHz: 48000,
    channels: 2,
    codec: 'pcm_s16le',
    bitDepth: 16,
};

export interface WasapiAdapterConfig {
    processId?: number | string;
    windowTitleIncludes?: string;
    executablesRoot?: string;
}

export class WasapiAdapter implements CaptureAdapter {
    public readonly id = 'wasapi';
    public readonly label = 'WASAPI Loopback';
    private readonly config: WasapiAdapterConfig;
    private events: CaptureAdapterEvents = {};
    private outputPath: string | null = null;
    private format: WavFormat | null = null;
    private writer: WavWriter | null = null;
    private bytesWritten = 0;
    private totalFrames = 0;
    private lastProgressAt = 0;
    private lastLevelAt = 0;
    private readonly progressIntervalMs = 300;
    private readonly levelIntervalMs = 250;
    private processId: string | null = null;
    private hasError = false;
    private isStopping = false;
    private executablesRoot: string | null = null;

    constructor(config: WasapiAdapterConfig = {}) {
        this.config = config;
    }

    public async isAvailable(): Promise<boolean> {
        if (process.platform !== 'win32' || process.arch !== 'x64') return false;

        const root = this.resolveExecutablesRoot();

        if (!root) return false;

        this.applyExecutablesRoot(root);

        try {
            await fsp.access(getLoopbackBinaryPath());
            await fsp.access(getProcessListBinaryPath());

            return true;
        } catch {
            return false;
        }
    }

    public async startRecording(options: CaptureAdapterStartOptions, events: CaptureAdapterEvents): Promise<void> {
        this.ensureWindowsSupport();

        if (this.writer) {
            throw new Error('Recording process is already running.');
        }

        const format = this.validateFormat(options.format);

        this.ensureExecutablesRoot();
        const configuredProcessId = this.resolveConfiguredProcessId();

        try {
            await fsp.access(getLoopbackBinaryPath());
        } catch {
            throw new Error(`WASAPI loopback binary is not accessible: ${getLoopbackBinaryPath()}`);
        }

        if (!configuredProcessId) {
            try {
                await fsp.access(getProcessListBinaryPath());
            } catch {
                throw new Error(`Process list binary is not accessible: ${getProcessListBinaryPath()}`);
            }
        }

        const processId = await this.resolveTargetProcessId();

        await fsp.mkdir(path.dirname(options.outputPath), { recursive: true });

        const writer = await WavWriter.create(options.outputPath, format);

        this.events = events;
        this.outputPath = options.outputPath;
        this.format = format;
        this.writer = writer;
        this.bytesWritten = 0;
        this.totalFrames = 0;
        this.lastProgressAt = 0;
        this.lastLevelAt = 0;
        this.processId = processId;
        this.hasError = false;
        this.isStopping = false;

        try {
            startAudioCapture(processId, { onData: this.handleAudioData });
        } catch (error) {
            try {
                await writer.finalize();
            } catch {
                // ignore cleanup errors
            }
            this.resetState();
            throw error;
        }
    }

    public async stopRecording(): Promise<RecordingResult> {
        if (!this.outputPath || !this.format || !this.writer || !this.processId) {
            throw new Error('Recording process is not running.');
        }

        const outputPath = this.outputPath;
        const format = this.format;
        const writer = this.writer;
        const bytesWritten = this.bytesWritten;
        const totalFrames = this.totalFrames;

        this.isStopping = true;

        try {
            stopAudioCapture(this.processId);
        } catch {
            // ignore stop errors
        }

        const durationMs = format.sampleRateHz > 0
            ? Math.round((totalFrames / format.sampleRateHz) * 1000)
            : undefined;

        try {
            await writer.finalize();
        } finally {
            this.resetState();
        }

        return {
            filePath: outputPath,
            format,
            durationMs,
            bytesWritten,
        };
    }

    private ensureWindowsSupport(): void {
        if (process.platform !== 'win32') {
            throw new Error('WASAPI loopback is supported only on Windows.');
        }

        if (process.arch !== 'x64') {
            throw new Error('WASAPI loopback requires a 64-bit Windows build.');
        }
    }

    private ensureExecutablesRoot(): string {
        const root = this.resolveExecutablesRoot();

        if (!root) {
            throw new Error('application-loopback binaries were not found.');
        }

        this.applyExecutablesRoot(root);

        return root;
    }

    private applyExecutablesRoot(root: string): void {
        if (this.executablesRoot === root) return;

        this.executablesRoot = root;
        setExecutablesRoot(root);
    }

    private resolveExecutablesRoot(): string | null {
        if (this.config.executablesRoot) return this.config.executablesRoot;

        const envRoot = process.env.APPLICATION_LOOPBACK_ROOT?.trim();

        if (envRoot) return envRoot;

        const appPath = app.getAppPath();
        const devRoot = path.resolve(appPath, 'node_modules', 'application-loopback', 'bin');
        const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? appPath;
        const packagedRoot = path.resolve(
            resourcesPath,
            'app.asar.unpacked',
            'node_modules',
            'application-loopback',
            'bin',
        );
        const candidates = app.isPackaged ? [packagedRoot, devRoot] : [devRoot, packagedRoot];

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }

        return null;
    }

    private async resolveTargetProcessId(): Promise<string> {
        const explicitId = this.resolveConfiguredProcessId();

        if (explicitId) {
            return explicitId;
        }

        let windows: Window[];

        try {
            windows = await getActiveWindowProcessIds();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            throw new Error(`Failed to list windows for WASAPI capture: ${message}`);
        }

        if (!windows.length) {
            throw new Error('No visible application windows found for WASAPI capture.');
        }

        const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');
        const titleIncludes = this.resolveWindowTitleIncludes();
        const normalizedTitleIncludes = titleIncludes ? normalize(titleIncludes) : null;
        const candidates = normalizedTitleIncludes
            ? windows.filter((win) => normalize(win.title).includes(normalizedTitleIncludes))
            : windows;

        const appName = app.getName?.();
        const normalizedAppName = appName ? normalize(appName) : '';
        const withoutSelf = normalizedAppName
            ? candidates.filter((win) => !normalize(win.title).includes(normalizedAppName))
            : candidates;
        const chosen = withoutSelf[0] ?? candidates[0];

        if (!chosen) {
            throw new Error('No suitable application window found for WASAPI capture.');
        }

        return chosen.processId;
    }

    private resolveConfiguredProcessId(): string | null {
        if (this.config.processId !== undefined) {
            return String(this.config.processId);
        }

        const envProcessId = process.env.WASAPI_PROCESS_ID?.trim();

        return envProcessId ? envProcessId : null;
    }

    private resolveWindowTitleIncludes(): string | null {
        const raw = this.config.windowTitleIncludes ?? process.env.WASAPI_WINDOW_TITLE;

        if (!raw) return null;

        const trimmed = raw.trim();

        return trimmed ? trimmed.toLowerCase() : null;
    }

    private validateFormat(format: WavFormat): WavFormat {
        if (format.codec !== WASAPI_WAV_FORMAT.codec) {
            throw new Error(`WASAPI supports only ${WASAPI_WAV_FORMAT.codec}, got ${format.codec}.`);
        }

        if (format.bitDepth !== WASAPI_WAV_FORMAT.bitDepth) {
            throw new Error(`WASAPI supports only ${WASAPI_WAV_FORMAT.bitDepth}-bit PCM.`);
        }

        if (format.channels !== WASAPI_WAV_FORMAT.channels) {
            throw new Error(`WASAPI outputs ${WASAPI_WAV_FORMAT.channels} channels.`);
        }

        if (format.sampleRateHz !== WASAPI_WAV_FORMAT.sampleRateHz) {
            throw new Error(`WASAPI outputs ${WASAPI_WAV_FORMAT.sampleRateHz} Hz.`);
        }

        return format;
    }

    private reportError(error: Error): void {
        if (this.hasError) return;

        this.hasError = true;
        this.events.onError?.(error);
    }

    private readonly handleAudioData = (chunk: Uint8Array): void => {
        if (!this.writer || !this.format || this.isStopping) return;
        if (!chunk.length) return;

        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

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
    };

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
        this.events = {};
        this.outputPath = null;
        this.format = null;
        this.writer = null;
        this.bytesWritten = 0;
        this.totalFrames = 0;
        this.lastProgressAt = 0;
        this.lastLevelAt = 0;
        this.processId = null;
        this.hasError = false;
        this.isStopping = false;
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
