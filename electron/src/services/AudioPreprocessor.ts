import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import ffmpegPath from 'ffmpeg-static';
import type { Segment } from '../controllers/transcriptionController';
import { Loudnorm, type LoudnormOptions } from './Loudnorm';

interface AudioPreprocessorConfig {
    ffmpegExecutable?: string;
    tmpDirPrefix?: string;
}

export interface ConvertAudioOptions {
    audioPath: string;
    loudnorm?: boolean | LoudnormOptions;
    dynanorm?: boolean | DynanormOptions;
    lowPass?: number;
    highPass?: number;
}

export interface WavFormat {
    sampleRateHz: number;
    channels: number;
    codec: string;
    bitDepth: number;
}

interface AudioFilterOptions {
    lowPassHz?: number;
    highPassHz?: number;
}

interface TrimResult {
    path: string;
    cleanup?: () => Promise<void>;
}

export interface WavResult {
    path: string;
    cleanup: () => Promise<void>;
}

interface PreparedAudioResult {
    wavPath: string;
    cleanup: () => Promise<void>;
}

// https://ffmpeg.org/ffmpeg-filters.html#dynaudnorm
interface DynanormOptions {
    f?: number; // framelen
    g?: number; // gausssize
    p?: number; // peak
}

const DEFAULT_TMP_PREFIX = 'finelistener-';
const DEFAULT_DYNAUDNORM_OPTIONS: Required<DynanormOptions> = {
    f: 150,
    g: 15,
    p: 0.95,
};
const DEFAULT_HIGH_PASS_HZ = 80;

export const DEFAULT_WAV_FORMAT: WavFormat = {
    sampleRateHz: 16000,
    channels: 1,
    codec: 'pcm_s16le',
    bitDepth: 16,
};
const tempDirs = new Set<string>();

export const cleanupAudioTempDirs = async (): Promise<void> => {
    const dirs = Array.from(tempDirs);

    await Promise.all(
        dirs.map(async (dir) => {
            try {
                await fs.rm(dir, { recursive: true, force: true });
            } catch {
                // ignore cleanup errors on shutdown
            }
        }),
    );

    tempDirs.clear();
};

export class AudioPreprocessor {
    private ffmpegExecutable: string | null;
    private readonly tmpDirPrefix: string;
    private readonly loudnessNormalizer: Loudnorm;

    constructor(config: AudioPreprocessorConfig = {}) {
        this.ffmpegExecutable = config.ffmpegExecutable ?? null;
        this.tmpDirPrefix = config.tmpDirPrefix ?? DEFAULT_TMP_PREFIX;
        this.loudnessNormalizer = new Loudnorm({
            runFfmpegWithStderr: (args) => this.runFfmpegWithStderr(args),
            buildAnalysisArgs: (audioPath, filterChain) => this.buildAnalysisArgs(audioPath, filterChain),
        });
    }

    public async trimAudio(audioPath: string, segment?: Segment): Promise<TrimResult> {
        if (!segment) {
            return { path: audioPath };
        }
        const { start, end } = segment;

        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
            return { path: audioPath };
        }

        const tmpDir = await this.createTempDir();
        const sourceExt = path.extname(audioPath) || '.wav';
        const trimmedPath = path.join(tmpDir, `${randomUUID()}${sourceExt}`);
        const duration = end - start;

        try {
            await this.runFfmpeg([
                '-y',
                '-ss',
                String(start),
                '-t',
                String(duration),
                '-i',
                audioPath,
                '-acodec',
                'copy',
                '-vn',
                trimmedPath,
            ]);
        } catch (error: unknown) {
            await this.removeDirSafe(tmpDir);
            const message = error instanceof Error ? error.message : String(error);

            throw new Error(`Не удалось подготовить фрагмент аудио: ${message}`);
        }

        const cleanup = async () => {
            await this.removeDirSafe(tmpDir);
        };

        return { path: trimmedPath, cleanup };
    }

    public async convertAudio({
        audioPath,
        loudnorm,
        dynanorm,
        lowPass,
        highPass,
    }: ConvertAudioOptions): Promise<WavResult> {
        const filters = this.resolveFilterOptions({ lowPass, highPass });
        const baseFilters = this.buildFrequencyFilters(filters);
        const tmpDir = await this.createTempDir();
        const wavPath = path.join(tmpDir, `${randomUUID()}.wav`);

        try {
            const loudnormFilter = await this.loudnessNormalizer.buildFilter(audioPath, baseFilters, loudnorm);
            const dynanormFilter = this.buildDynanormFilter(dynanorm);
            const filterChain = this.buildFilterChain([...baseFilters, loudnormFilter, dynanormFilter]);
            const startTime = Date.now();

            await this.runFfmpeg(this.buildWavArgs(audioPath, wavPath, filterChain));
            console.log('audio converted: ', Date.now() - startTime, ' ms');
        } catch (error) {
            await this.removeDirSafe(tmpDir);
            const message = error instanceof Error ? error.message : String(error);

            throw new Error(`Не удалось конвертировать аудио в WAV: ${message}`);
        }

        const cleanup = async () => {
            await this.removeDirSafe(tmpDir);
        };

        return { path: wavPath, cleanup };
    }

    public async prepareAudioFile(
        audioPath: string,
        segment?: Segment,
        convertOptions: Omit<ConvertAudioOptions, 'audioPath'> = {},
    ): Promise<PreparedAudioResult> {
        const { path: trimmedPath, cleanup: trimCleanup } = await this.trimAudio(audioPath, segment);
        const { path: wavPath, cleanup: wavCleanup } = await this.convertAudio({
            audioPath: trimmedPath,
            ...convertOptions,
        }).catch(async (err) => {
            if (trimCleanup) {
                await trimCleanup().catch(() => void 0);
            }
            throw err;
        });

        const cleanup = async () => {
            await wavCleanup().catch(() => void 0);
            if (trimCleanup) {
                await trimCleanup().catch(() => void 0);
            }
        };

        return { wavPath, cleanup };
    }

    protected async createTempDir(): Promise<string> {
        const dir = await fs.mkdtemp(path.join(tmpdir(), this.tmpDirPrefix));

        tempDirs.add(dir);

        return dir;
    }

    protected async removeDirSafe(dir: string | undefined): Promise<void> {
        if (!dir) return;

        try {
            await fs.rm(dir, { recursive: true, force: true });
            tempDirs.delete(dir);
        } catch {
            // keep entry for shutdown cleanup
        }
    }

    protected async runFfmpeg(args: string[]): Promise<void> {
        await this.executeFfmpeg(args);
    }

    protected async runFfmpegWithStderr(args: string[]): Promise<string> {
        return this.executeFfmpeg(args);
    }

    private resolveFilterOptions(options: { lowPass?: number; highPass?: number }): AudioFilterOptions {
        const highPass = options.highPass === undefined ? DEFAULT_HIGH_PASS_HZ : options.highPass;

        return {
            lowPassHz: this.normalizeFrequency('lowpass', options.lowPass),
            highPassHz: this.normalizeFrequency('highpass', highPass),
        };
    }

    private normalizeFrequency(type: 'lowpass' | 'highpass', frequency?: number): number | undefined {
        if (frequency === undefined) return undefined;

        if (!Number.isFinite(frequency) || frequency <= 0) {
            const label = type === 'lowpass' ? 'низких частот' : 'высоких частот';

            throw new Error(`Некорректное значение фильтра ${label}: ${frequency}`);
        }

        return frequency;
    }

    private buildFrequencyFilters(filters: AudioFilterOptions): string[] {
        const chain: string[] = [];
        const highPass = this.buildFrequencyFilter('highpass', filters.highPassHz);
        const lowPass = this.buildFrequencyFilter('lowpass', filters.lowPassHz);

        if (highPass) {
            chain.push(highPass);
        }
        if (lowPass) {
            chain.push(lowPass);
        }

        return chain;
    }

    private buildFilterChain(filters: Array<string | null | undefined>): string | null {
        const normalized = filters.filter((filter): filter is string => Boolean(filter));

        return normalized.length > 0 ? normalized.join(',') : null;
    }

    private buildWavArgs(audioPath: string, outputPath: string, filterChain?: string | null): string[] {
        return [
            ...this.buildBaseArgs(audioPath, filterChain),
            '-ar',
            String(DEFAULT_WAV_FORMAT.sampleRateHz),
            '-ac',
            String(DEFAULT_WAV_FORMAT.channels),
            '-c:a',
            DEFAULT_WAV_FORMAT.codec,
            outputPath,
        ];
    }

    private buildAnalysisArgs(audioPath: string, filterChain?: string | null): string[] {
        return [
            ...this.buildBaseArgs(audioPath, filterChain),
            '-ar',
            String(DEFAULT_WAV_FORMAT.sampleRateHz),
            '-ac',
            String(DEFAULT_WAV_FORMAT.channels),
            '-f',
            'null',
            '-',
        ];
    }

    private buildBaseArgs(audioPath: string, filterChain?: string | null): string[] {
        const args = ['-y', '-i', audioPath];

        if (filterChain) {
            args.push('-af', filterChain);
        }

        return args;
    }

    private buildFrequencyFilter(type: 'lowpass' | 'highpass', frequency?: number): string | null {
        if (frequency === undefined) return null;

        return `${type}=f=${frequency}`;
    }

    private buildDynanormFilter(options?: boolean | DynanormOptions): string | null {
        const resolved = this.resolveDynanormOptions(options);

        if (!resolved) {
            return null;
        }

        return `dynaudnorm=f=${resolved.f}:g=${resolved.g}:p=${resolved.p}`;
    }

    private resolveDynanormOptions(options?: boolean | DynanormOptions): Required<DynanormOptions> | null {
        if (options === false) {
            return null;
        }

        if (options === undefined || options === true) {
            return { ...DEFAULT_DYNAUDNORM_OPTIONS };
        }

        return {
            f: this.ensureFiniteNumber(options.f ?? DEFAULT_DYNAUDNORM_OPTIONS.f, 'dynaudnorm f'),
            g: this.ensureFiniteNumber(options.g ?? DEFAULT_DYNAUDNORM_OPTIONS.g, 'dynaudnorm g'),
            p: this.ensureFiniteNumber(options.p ?? DEFAULT_DYNAUDNORM_OPTIONS.p, 'dynaudnorm p'),
        };
    }

    private ensureFiniteNumber(value: number, label: string): number {
        if (!Number.isFinite(value)) {
            throw new Error(`Invalid parameter value ${label}: ${value}`);
        }

        return value;
    }

    private async executeFfmpeg(args: string[]): Promise<string> {
        const ffmpegExecutable = this.getFfmpegExecutable();

        return new Promise<string>((resolve, reject) => {
            const ffmpeg = spawn(ffmpegExecutable, args, { windowsHide: true });
            let stderr = '';

            ffmpeg.stderr?.on('data', (chunk: unknown) => {
                const data = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : '';

                stderr += data;
            });

            ffmpeg.on('error', reject);
            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    resolve(stderr);
                } else {
                    reject(new Error(`ffmpeg exited with code ${code}${stderr ? `: ${stderr}` : ''}`));
                }
            });
        });
    }

    private getFfmpegExecutable(): string {
        if (this.ffmpegExecutable) return this.ffmpegExecutable;

        this.ffmpegExecutable = this.resolveFfmpegExecutable();

        return this.ffmpegExecutable;
    }

    private resolveFfmpegExecutable(): string {
        if (!ffmpegPath) {
            throw new Error('ffmpeg-static binary path is empty');
        }

        return ffmpegPath.replace('app.asar', 'app.asar.unpacked');
    }
}
