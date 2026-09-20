import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { app } from 'electron';
import type { WavFormat } from '../AudioPreprocessor';
import type { RecordingResult, RecordingSourceFailure, RecordingTrack } from '../RecordingService';
import type {
    CaptureAdapter,
    CaptureAdapterEvents,
    CaptureAdapterStartOptions,
    RecordingDevice,
    RecordingSourceKind,
} from './CaptureAdapter';

export const MINIAUDIO_WAV_FORMAT: WavFormat = {
    sampleRateHz: 16000,
    channels: 1,
    codec: 'pcm_s16le',
    bitDepth: 16,
};

export interface MiniAudioAdapterConfig {
    binaryPath?: string;
}

type HelperMessage =
    | { type: 'ready' }
    | { type: 'finished'; durationMs: number }
    | { type: 'source-error'; source: RecordingSourceKind; message: string }
    | { type: 'progress'; durationMs: number; bytesWritten?: number }
    | { type: 'level'; source?: RecordingSourceKind; rms: number; peak: number; clipped?: boolean }
    | { type: 'error'; message: string; recoverable?: boolean }
    | { type: 'format'; sampleRateHz: number; channels: number; bitDepth: number; codec: string };

export class MiniAudioAdapter implements CaptureAdapter {
    public readonly id = 'miniaudio';
    public readonly label = 'MiniAudio Loopback';
    private readonly config: MiniAudioAdapterConfig;
    private process: ChildProcessWithoutNullStreams | null = null;
    private exitPromise: Promise<RecordingResult> | null = null;
    private outputPath: string | null = null;
    private format: WavFormat | null = null;
    private events: CaptureAdapterEvents = {};
    private stdoutBuffer = '';
    private stderrBuffer = '';
    private lastHelperError: string | null = null;
    private lastHelperErrorRecoverable = false;
    private lastBytesWritten: number | undefined;
    private isStopping = false;
    private ready = false;
    private resolveReady: (() => void) | null = null;
    private rejectReady: ((error: Error) => void) | null = null;
    private tracks: RecordingTrack[] = [];
    private sourceFailures: RecordingSourceFailure[] = [];
    private durationMs = 0;
    private finished = false;
    private lastResult: RecordingResult | null = null;

    constructor(config: MiniAudioAdapterConfig = {}) {
        this.config = config;
    }

    public async isAvailable(): Promise<boolean> {
        if (!this.isSupportedWindows()) return false;

        const helperPath = this.findBinaryPath();

        if (!helperPath) return false;

        try {
            await fsp.access(helperPath);

            return true;
        } catch {
            return false;
        }
    }

    public async listDevices(): Promise<RecordingDevice[]> {
        this.ensureWindowsSupport();

        const helperPath = this.resolveBinaryPath();

        try {
            await fsp.access(helperPath);
        } catch {
            throw new Error(`MiniAudio helper is not accessible: ${helperPath}`);
        }

        const { stdout, stderr } = await this.runHelper(helperPath, ['--list-devices']);

        if (stderr.trim()) {
            throw new Error(`MiniAudio helper error: ${stderr.trim()}`);
        }

        const payload = stdout.trim();

        if (!payload) {
            return [];
        }

        let parsed: unknown;

        try {
            parsed = JSON.parse(payload);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            throw new Error(`Failed to parse device list: ${message}`);
        }

        if (!Array.isArray(parsed)) {
            throw new Error('Device list is not an array.');
        }

        const devices: RecordingDevice[] = [];

        for (const item of parsed) {
            if (!item || typeof item !== 'object') continue;

            const record = item as Record<string, unknown>;
            const id = typeof record.id === 'string' ? record.id : '';
            const name = typeof record.name === 'string' ? record.name : '';
            const isDefault = typeof record.isDefault === 'boolean' ? record.isDefault : undefined;
            const index = typeof record.index === 'number' ? record.index : undefined;

            if (!id && !name) continue;

            const source = record.source === 'microphone' ? 'microphone' : 'system';

            devices.push({ id, name, isDefault, index, source });
        }

        return devices;
    }

    public async startRecording(options: CaptureAdapterStartOptions, events: CaptureAdapterEvents): Promise<void> {
        this.ensureWindowsSupport();

        if (this.process) {
            throw new Error('Recording process is already running.');
        }

        const format = this.validateFormat(options.format);
        const helperPath = this.resolveBinaryPath();

        try {
            await fsp.access(helperPath);
        } catch {
            throw new Error(`MiniAudio helper is not accessible: ${helperPath}`);
        }

        this.events = events;
        this.outputPath = options.outputPath;
        this.format = format;
        this.stdoutBuffer = '';
        this.stderrBuffer = '';
        this.lastHelperError = null;
        this.lastHelperErrorRecoverable = false;
        this.lastBytesWritten = undefined;
        this.isStopping = false;
        this.ready = false;
        this.finished = false;
        this.lastResult = null;
        this.durationMs = 0;
        this.sourceFailures = [];
        const sources = options.sources ?? { system: this.resolveDeviceId(options.deviceId) ?? '' };

        this.tracks = [];
        if (typeof sources.system === 'string') this.tracks.push({ source: 'system', filePath: options.outputPath, startOffsetMs: 0 });
        if (typeof sources.microphone === 'string') {
            this.tracks.push({ source: 'microphone', filePath: this.tracks.length ? `${options.outputPath.slice(0, -4)}-microphone-${randomUUID()}.wav` : options.outputPath, startOffsetMs: 0 });
        }
        if (!this.tracks.length) throw new Error('Select at least one recording source.');

        await fsp.mkdir(path.dirname(options.outputPath), { recursive: true });

        const args = this.buildHelperArgs(options);
        const proc = spawn(helperPath, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

        this.process = proc;
        const readyPromise = new Promise<void>((resolve, reject) => {
            this.resolveReady = resolve;
            this.rejectReady = reject;
        });
        this.exitPromise = this.createExitPromise(proc);
        // The process may fail before the user asks to stop. Observe rejection now.
        void this.exitPromise.catch((error: unknown) => {
            console.error('MiniAudio capture process failed:', error);
        });
        proc.stdin.on('error', (error) => console.error('MiniAudio control pipe failed:', error));
        proc.stdout?.setEncoding('utf8');
        proc.stdout?.on('data', this.handleStdout);

        proc.stderr?.setEncoding('utf8');
        proc.stderr?.on('data', this.handleStderr);
        const readyTimeout = setTimeout(() => {
            this.rejectReady?.(new Error('Recording devices did not become ready.'));
            proc.stdin.end('stop\n');
        }, 15000);

        try {
            await readyPromise;
        } catch (error) {
            const exitPromise = this.exitPromise;
            const failedPaths = this.tracks.map((track) => track.filePath);
            const timeout = setTimeout(() => proc.kill(), 5000);

            try {
                await exitPromise;
            } catch (exitError) {
                console.error('MiniAudio start cleanup:', exitError);
            } finally {
                clearTimeout(timeout);
                await Promise.all(failedPaths.map((filePath) => fsp.rm(filePath, { force: true })));
            }
            throw error;
        } finally {
            clearTimeout(readyTimeout);
            this.resolveReady = null;
            this.rejectReady = null;
        }
    }

    public async stopRecording(): Promise<RecordingResult> {
        if (!this.process || !this.exitPromise) {
            if (this.lastResult) return this.lastResult;
            throw new Error('Recording process is not running.');
        }

        const proc = this.process;
        const exitPromise = this.exitPromise;

        this.isStopping = true;

        // Windows kill signals terminate immediately without finalizing WAV headers.
        if (!proc.stdin.destroyed && !proc.stdin.writableEnded) proc.stdin.end('stop\n');

        const killTimeout = setTimeout(() => {
            if (this.process === proc) {
                proc.kill();
            }
        }, 5000);

        try {
            return await exitPromise;
        } finally {
            clearTimeout(killTimeout);
        }
    }

    private isSupportedWindows(): boolean {
        return process.platform === 'win32';
    }

    private ensureWindowsSupport(): void {
        if (!this.isSupportedWindows()) {
            throw new Error('MiniAudio loopback is supported only on Windows.');
        }
    }

    private validateFormat(format: WavFormat): WavFormat {
        if (format.codec !== MINIAUDIO_WAV_FORMAT.codec) {
            throw new Error(`MiniAudio supports only ${MINIAUDIO_WAV_FORMAT.codec}, got ${format.codec}.`);
        }

        if (format.bitDepth !== MINIAUDIO_WAV_FORMAT.bitDepth) {
            throw new Error(`MiniAudio supports only ${MINIAUDIO_WAV_FORMAT.bitDepth}-bit PCM.`);
        }

        if (format.channels !== MINIAUDIO_WAV_FORMAT.channels) {
            throw new Error(`MiniAudio outputs ${MINIAUDIO_WAV_FORMAT.channels} channel(s).`);
        }

        if (format.sampleRateHz !== MINIAUDIO_WAV_FORMAT.sampleRateHz) {
            throw new Error(`MiniAudio outputs ${MINIAUDIO_WAV_FORMAT.sampleRateHz} Hz.`);
        }

        return format;
    }

    private buildHelperArgs(options: CaptureAdapterStartOptions): string[] {
        const args: string[] = [
            '--output',
            options.outputPath,
            '--sample-rate',
            String(options.format.sampleRateHz),
            '--channels',
            String(options.format.channels),
            '--bit-depth',
            String(options.format.bitDepth),
        ];

        const sources = options.sources ?? { system: this.resolveDeviceId(options.deviceId) ?? '' };

        if (typeof sources.system !== 'string') args.push('--system-off');
        else if (sources.system) args.push('--device-id', sources.system);
        const microphone = this.tracks.find((track) => track.source === 'microphone');

        if (microphone) {
            args.push('--microphone-output', microphone.filePath);
            if (sources.microphone) args.push('--microphone-device-id', sources.microphone);
        }

        return args;
    }

    private resolveDeviceId(deviceId?: string): string | null {
        if (deviceId) return deviceId;

        const env = process.env.MINIAUDIO_DEVICE_ID?.trim();

        return env || null;
    }

    private resolveBinaryPath(): string {
        const resolved = this.findBinaryPath();

        if (!resolved) {
            throw new Error('MiniAudio helper path is not configured.');
        }

        return resolved;
    }

    private findBinaryPath(): string | null {
        if (this.config.binaryPath) return this.config.binaryPath;

        const envPath = process.env.MINIAUDIO_HELPER_PATH?.trim();

        if (envPath) return envPath;

        const exeName = process.platform === 'win32' ? 'miniaudio-loopback.exe' : 'miniaudio-loopback';
        const appPath = app.getAppPath();
        const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? appPath;
        const cwd = process.cwd();

        const devCandidates = [
            path.resolve(cwd, 'miniaudio-loopback', 'bin', exeName),
            path.resolve(cwd, 'miniaudio-loopback', exeName),
            path.resolve(appPath, 'miniaudio-loopback', 'bin', exeName),
            path.resolve(appPath, '..', 'miniaudio-loopback', 'bin', exeName),
            path.resolve(appPath, '..', '..', 'miniaudio-loopback', 'bin', exeName),
        ];
        const packagedCandidates = [
            path.resolve(resourcesPath, 'miniaudio-loopback', exeName),
            path.resolve(resourcesPath, 'miniaudio-loopback', 'bin', exeName),
        ];
        const candidates = app.isPackaged ?
            packagedCandidates.concat(devCandidates) :
            devCandidates.concat(packagedCandidates);

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }

        return null;
    }

    private async runHelper(binaryPath: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
        return new Promise((resolve, reject) => {
            const proc = spawn(binaryPath, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
            let stdout = '';
            let stderr = '';

            proc.stdin?.end();
            proc.stdout?.setEncoding('utf8');
            proc.stdout?.on('data', (chunk) => {
                stdout += chunk;
            });

            proc.stderr?.setEncoding('utf8');
            proc.stderr?.on('data', (chunk) => {
                stderr += chunk;
            });

            proc.on('error', (error) => {
                reject(error);
            });

            proc.on('close', (code, signal) => {
                if (code !== 0 || signal) {
                    const details = this.formatExitDetails(code, signal, stderr.trim());

                    reject(new Error(`MiniAudio helper exited.${details}`));

                    return;
                }

                resolve({ stdout, stderr });
            });
        });
    }

    private createExitPromise(proc: ChildProcessWithoutNullStreams): Promise<RecordingResult> {
        return new Promise((resolve, reject) => {
            let settled = false;
            const succeed = (sourceFailures: RecordingSourceFailure[]): void => {
                if (settled) return;
                settled = true;
                this.sourceFailures = sourceFailures;
                const result: RecordingResult = {
                    filePath: this.outputPath!,
                    format: this.format!,
                    durationMs: this.durationMs,
                    bytesWritten: this.lastBytesWritten,
                    tracks: this.tracks.map((track) => ({
                        ...track,
                        durationMs: this.durationMs,
                        failure: sourceFailures.find((failure) => failure.source === track.source)?.message,
                    })),
                    sourceFailures,
                };
                const events = this.events;
                const automatic = !this.isStopping;

                this.lastResult = result;
                this.process = null;
                this.exitPromise = null;
                this.events = {};
                resolve(result);
                if (automatic) events.onFinished?.(result);
            };
            const fail = (error: Error): void => {
                if (settled) return;
                settled = true;
                const wasReady = this.ready;
                const events = this.events;

                this.rejectReady?.(error);
                this.process = null;
                this.exitPromise = null;
                this.events = {};
                reject(error);
                if (wasReady && !this.isStopping) events.onError?.(error);
            };

            proc.on('error', fail);
            proc.on('close', (code, signal) => {
                if (settled) return;
                if (this.ready && this.lastHelperErrorRecoverable) {
                    const sourceFailures = this.tracks.map((track) =>
                        this.sourceFailures.find((failure) => failure.source === track.source) ?? {
                            source: track.source,
                            message: 'Recording source may be incomplete.',
                        });

                    succeed(sourceFailures);

                    return;
                }
                if (code !== 0 || signal || !this.ready || !this.finished || this.lastHelperError) {
                    fail(new Error(this.lastHelperError ?? `MiniAudio helper exited before finalizing.${this.formatExitDetails(code, signal, this.stderrBuffer.trim())}`));

                    return;
                }
                succeed(this.sourceFailures);
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
            case 'ready':
                this.ready = true;
                this.resolveReady?.();

                return;
            case 'finished':
                this.finished = true;
                this.durationMs = message.durationMs;

                return;
            case 'source-error':
                if (message.source !== 'system' && message.source !== 'microphone') return;
                this.sourceFailures = [...this.sourceFailures.filter((failure) => failure.source !== message.source), { source: message.source, message: message.message }];
                this.events.onProgress?.({ durationMs: this.durationMs, sourceFailures: this.sourceFailures });

                return;
            case 'progress':
                this.durationMs = message.durationMs;
                if (typeof message.bytesWritten === 'number') {
                    this.lastBytesWritten = message.bytesWritten;
                }
                this.events.onProgress?.({
                    durationMs: message.durationMs,
                    bytesWritten: message.bytesWritten,
                    sourceFailures: this.sourceFailures,
                });

                return;
            case 'level':
                this.events.onLevel?.({
                    rms: message.rms,
                    peak: message.peak,
                    clipped: Boolean(message.clipped),
                    source: message.source,
                });

                return;
            case 'error':
                this.lastHelperError = message.message;
                this.lastHelperErrorRecoverable = message.recoverable === true;
                this.rejectReady?.(new Error(message.message));

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
