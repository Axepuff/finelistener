import { spawn } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import https from 'https';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';
import { app } from 'electron';
import type { SessionSpeakerInterval } from '../types/sessions';
import type { SpeakerAssetStatus } from '../types/transcription';
import { AudioPreprocessor } from './AudioPreprocessor';

const CLI = process.platform === 'win32' ? 'sherpa-onnx-offline-speaker-diarization.exe' : 'sherpa-onnx-offline-speaker-diarization';
const VERSION = 'v1.13.8';

export interface SpeakerAnalysisOptions {
    startSec: number;
    endSec?: number;
    speakerCount?: number;
    preferCuda?: boolean;
}

export interface SpeakerAnalysisResult {
    intervals: SessionSpeakerInterval[];
    backend: 'cpu' | 'cuda';
    fallbackUsed: boolean;
}

export interface SpeakerPreparationProgress {
    downloadedBytes: number;
    totalBytes?: number;
}

export interface SpeakerAnalysisProgress {
    phase: 'converting' | 'analyzing' | 'fallback';
    percent?: number;
}

interface FileEntry {
    bytes: number;
    sha256: string;
}

interface AssetManifest {
    version: string;
    variant: string;
    files: Record<string, FileEntry>;
}

interface ComponentManifest {
    version: string;
    url: string;
    bytes: number;
    sha256: string;
    files: Record<string, FileEntry>;
}

interface CliResult {
    intervals: SessionSpeakerInterval[];
    gpuStages: { segmentation: boolean; embedding: boolean };
}

const isWithin = (root: string, candidate: string): boolean => {
    const relative = path.relative(root, candidate);
    return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

const validFileEntries = (value: unknown): value is Record<string, FileEntry> => {
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).every(([name, entry]) => {
        const file = entry as FileEntry;
        return Boolean(name) && !path.isAbsolute(name) && !name.split('/').includes('..')
            && Number.isSafeInteger(file?.bytes) && file.bytes > 0 && /^[a-f0-9]{64}$/i.test(file.sha256);
    });
};

export const parseSpeakerIntervals = (output: string, startSec: number, endSec?: number): SessionSpeakerInterval[] => {
    const rangeLength = endSec === undefined ? Infinity : endSec - startSec;
    const result: SessionSpeakerInterval[] = [];
    for (const line of output.split(/\r?\n/)) {
        const match = /^\s*(\d+(?:\.\d+)?) -- (\d+(?:\.\d+)?) (speaker_\d+)(?:\s|$)/.exec(line);
        if (!match) continue;
        const start = Number(match[1]);
        const end = Number(match[2]);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
        const localStart = endSec === undefined ? start - startSec : start;
        const localEnd = endSec === undefined ? end - startSec : end;
        if (localEnd <= 0 || localStart >= rangeLength) continue;
        result.push({ startSec: Math.max(0, localStart), endSec: Math.min(rangeLength, localEnd), speakerId: match[3] });
    }
    return result;
};

const readJson = async <T>(filePath: string): Promise<T> => JSON.parse(await fsp.readFile(filePath, 'utf8')) as T;

const hashFile = async (filePath: string): Promise<string> => {
    const hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer);
    return hash.digest('hex');
};

const stageLocalFile = async (source: string, target: string): Promise<void> => {
    try {
        await fsp.link(source, target);
    } catch {
        await fsp.copyFile(source, target);
    }
};

const filesMatch = async (root: string, entries: Record<string, FileEntry>, hash: boolean): Promise<boolean> => {
    for (const [name, entry] of Object.entries(entries)) {
        const target = path.resolve(root, name);
        if (!isWithin(root, target)) return false;
        try {
            const stat = await fsp.stat(target);
            if (!stat.isFile() || stat.size !== entry.bytes || (hash && await hashFile(target) !== entry.sha256)) return false;
        } catch {
            return false;
        }
    }
    return true;
};

const safeArchiveEntries = (listing: string, files: Record<string, FileEntry>): boolean => {
    const names = listing.split(/\r?\n/).filter(Boolean);
    if (names.length !== Object.keys(files).length) return false;
    return names.every((name) => {
        const normalized = name.replace(/\\/g, '/');
        return !normalized.startsWith('/') && !/^[a-z]:/i.test(normalized)
            && !normalized.split('/').some((part) => part === '..' || part === '')
            && Object.hasOwn(files, normalized);
    });
};

export const runSpeakerProcess = (binary: string, args: string[], signal: AbortSignal, cwd: string, env?: NodeJS.ProcessEnv, onProgress?: (percent: number) => void): Promise<{ stdout: string; stderr: string }> =>
    new Promise((resolve, reject) => {
        const child = spawn(binary, args, { cwd, env, signal, windowsHide: true });
        let stdout = '';
        let stderr = '';
        let processError: Error | null = null;
        let progressBuffer = '';
        let lastPercent = -1;
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
            stdout += chunk;
            if (stdout.length > 2_000_000) {
                processError = new Error('Sherpa output exceeded the limit');
                child.kill();
            }
        });
        child.stderr.on('data', (chunk: string) => {
            stderr = (stderr + chunk).slice(-100_000);
            progressBuffer += chunk;
            const lines = progressBuffer.split(/[\r\n]/);
            progressBuffer = (lines.pop() ?? '').slice(-1000);
            for (const line of lines) {
                const match = /^progress (\d+(?:\.\d+)?)%$/.exec(line.trim());
                if (!match) continue;
                const percent = Math.min(100, Math.floor(Number(match[1])));
                if (percent > lastPercent) {
                    lastPercent = percent;
                    onProgress?.(percent);
                }
            }
        });
        child.on('error', (error) => { processError = error; });
        child.on('close', (code) => {
            if (signal.aborted) reject(new Error('Speaker analysis cancelled'));
            else if (processError) reject(processError);
            else if (code !== 0) reject(new Error(`${path.basename(binary)} exited with ${code}: ${stderr}`));
            else resolve({ stdout, stderr });
        });
    });

const download = async (url: string, target: string, signal: AbortSignal, onProgress?: (progress: SpeakerPreparationProgress) => void): Promise<void> => {
    if (!url.startsWith('https://github.com/Axepuff/finelistener/releases/download/')) throw new Error('Invalid speaker component URL');
    let location = url;
    for (let redirects = 0; redirects <= 5; redirects += 1) {
        signal.throwIfAborted();
        const response = await new Promise<import('http').IncomingMessage>((resolve, reject) => {
            const request = https.get(location, { signal }, resolve);
            request.on('error', reject);
        });
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            response.resume();
            location = new URL(response.headers.location, location).toString();
            continue;
        }
        if (response.statusCode !== 200) {
            response.resume();
            throw new Error(`Speaker component download failed with HTTP ${response.statusCode}`);
        }
        const total = Number(response.headers['content-length']);
        let downloadedBytes = 0;
        response.on('data', (chunk: Buffer) => {
            downloadedBytes += chunk.length;
            onProgress?.({ downloadedBytes, totalBytes: Number.isFinite(total) && total > 0 ? total : undefined });
        });
        await pipeline(response, fs.createWriteStream(target, { flags: 'w' }), { signal });
        return;
    }
    throw new Error('Too many speaker component redirects');
};

export class SpeakerDiarizationService {
    private readonly audio = new AudioPreprocessor();

    private bundleRoot(): string {
        if (app.isPackaged) return path.join(process.resourcesPath, 'sherpa');
        const variants = process.platform === 'win32' ? ['win-x64-gpu', 'win-x64-cpu'] : ['mac-arm64'];
        const roots = variants.map((variant) => path.join(app.getAppPath(), 'build-assets', variant, 'sherpa'));
        return roots.find((root) => fs.existsSync(path.join(root, 'asset-manifest.json'))) ?? roots[0];
    }

    private installedCudaRoot(): string {
        return path.join(app.getPath('userData'), 'sherpa', `cuda-${VERSION}`);
    }

    private devCudaRoot(): string {
        return path.join(app.getAppPath(), 'build-assets', 'sherpa-cuda-component');
    }

    private async manifest(): Promise<AssetManifest | null> {
        try {
            const manifest = await readJson<AssetManifest>(path.join(this.bundleRoot(), 'asset-manifest.json'));
            return manifest.version === VERSION && validFileEntries(manifest.files) ? manifest : null;
        } catch {
            return null;
        }
    }

    private async component(): Promise<ComponentManifest | null> {
        try {
            const manifest = await readJson<ComponentManifest>(path.join(this.bundleRoot(), 'cuda-component.json'));
            return manifest.version === VERSION && Number.isSafeInteger(manifest.bytes) && manifest.bytes > 0
                && /^[a-f0-9]{64}$/i.test(manifest.sha256) && validFileEntries(manifest.files) ? manifest : null;
        } catch {
            return null;
        }
    }

    private async inspectAssets(): Promise<SpeakerAssetStatus & { cudaRoot: string | null }> {
        const root = this.bundleRoot();
        const manifest = await this.manifest();
        const cpuReady = Boolean(manifest && await filesMatch(root, manifest.files, true));
        const component = await this.component();
        let cudaRoot: string | null = null;
        if (component) {
            const candidates = app.isPackaged ? [this.installedCudaRoot()] : [this.devCudaRoot(), this.installedCudaRoot()];
            for (const candidate of candidates) {
                if (await filesMatch(candidate, component.files, true)) {
                    cudaRoot = candidate;
                    break;
                }
            }
        }
        const cudaReady = cudaRoot !== null;
        const driver = process.platform === 'win32' && fs.existsSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'nvcuda.dll'));
        return { cpuReady, cudaReady, cudaAvailable: Boolean(component && driver), cudaRoot };
    }

    public async getAssetStatus(): Promise<SpeakerAssetStatus> {
        const { cpuReady, cudaReady, cudaAvailable } = await this.inspectAssets();
        return { cpuReady, cudaReady, cudaAvailable };
    }

    public async prepareAssets(includeCuda: boolean, signal: AbortSignal, onProgress?: (progress: SpeakerPreparationProgress) => void): Promise<void> {
        signal.throwIfAborted();
        const status = await this.getAssetStatus();
        if (!status.cpuReady) throw new Error('Bundled speaker assets are missing');
        if (!includeCuda || status.cudaReady) return;
        const component = await this.component();
        if (!component) throw new Error('CUDA speaker component is unavailable in this build');
        const parent = path.dirname(this.installedCudaRoot());
        await fsp.mkdir(parent, { recursive: true });
        const temp = await fsp.mkdtemp(path.join(parent, 'cuda-download-'));
        const archive = path.join(temp, 'component.zip');
        const extracted = path.join(temp, 'extracted');
        try {
            await download(component.url, archive, signal, onProgress);
            if ((await fsp.stat(archive)).size !== component.bytes || await hashFile(archive) !== component.sha256) {
                throw new Error('Speaker component integrity check failed');
            }
            await fsp.mkdir(extracted);
            const tar = process.platform === 'win32' ? 'tar.exe' : 'tar';
            const listing = await runSpeakerProcess(tar, ['-tf', archive], signal, temp);
            if (!safeArchiveEntries(listing.stdout, component.files)) throw new Error('Speaker component contains unexpected files');
            await runSpeakerProcess(tar, ['-xf', archive, '-C', extracted], signal, temp);
            if (!await filesMatch(extracted, component.files, true)) throw new Error('Speaker component files failed integrity check');
            signal.throwIfAborted();
            const target = this.installedCudaRoot();
            if (await filesMatch(target, component.files, true)) return;
            const backup = path.join(parent, `cuda-previous-${randomUUID()}`);
            let movedPrevious = false;
            try {
                await fsp.rename(target, backup);
                movedPrevious = true;
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            }
            try {
                await fsp.rename(extracted, target);
            } catch (error) {
                if (movedPrevious) await fsp.rename(backup, target);
                throw error;
            }
            if (movedPrevious) await fsp.rm(backup, { recursive: true, force: true });
        } finally {
            await fsp.rm(temp, { recursive: true, force: true });
        }
    }

    public async analyze(
        audioPath: string,
        options: SpeakerAnalysisOptions,
        signal: AbortSignal,
        onProgress?: (progress: SpeakerAnalysisProgress) => void,
    ): Promise<SpeakerAnalysisResult> {
        if (!Number.isFinite(options.startSec) || options.startSec < 0
            || (options.endSec !== undefined && (!Number.isFinite(options.endSec) || options.endSec <= options.startSec))
            || (options.speakerCount !== undefined && (!Number.isSafeInteger(options.speakerCount) || options.speakerCount < 1))) {
            throw new Error('Invalid speaker analysis range or count');
        }
        signal.throwIfAborted();
        const status = await this.inspectAssets();
        if (!status.cpuReady) throw new Error('Speaker assets are not ready');
        onProgress?.({ phase: 'converting' });
        const segment = options.endSec === undefined ? undefined : { start: options.startSec, end: options.endSec };
        const prepared = await this.audio.prepareAudioSegmentExactly(audioPath, segment, signal);
        try {
            signal.throwIfAborted();
            const useCuda = Boolean(options.preferCuda && status.cudaReady && status.cudaAvailable);
            if (useCuda) {
                try {
                    onProgress?.({ phase: 'analyzing' });
                    // Profiling an entire recording accumulates millions of events in native memory.
                    // Verify both providers on a bounded sample, then run without profiling.
                    const probe = await this.audio.prepareAudioSegmentExactly(prepared.wavPath, { start: 0, end: 30 }, signal);
                    let verified: boolean;
                    try {
                        const result = await this.runCli(probe.wavPath, { startSec: 0, endSec: 30 }, signal, 'cuda', status.cudaRoot, undefined, true);
                        verified = result.gpuStages.segmentation && result.gpuStages.embedding;
                    } finally {
                        await probe.cleanup();
                    }
                    if (verified) {
                        const cuda = await this.runCli(prepared.wavPath, options, signal, 'cuda', status.cudaRoot, onProgress);
                        return { intervals: cuda.intervals, backend: 'cuda', fallbackUsed: false };
                    }
                    console.warn('Sherpa CUDA run did not demonstrate execution in both model stages; retrying on CPU');
                } catch (error) {
                    if (signal.aborted) throw error;
                    console.warn('Sherpa CUDA initialization or execution failed; retrying on CPU', error);
                }
                signal.throwIfAborted();
                onProgress?.({ phase: 'fallback' });
                const cpu = await this.runCli(prepared.wavPath, options, signal, 'cpu', undefined, onProgress);
                return { intervals: cpu.intervals, backend: 'cpu', fallbackUsed: true };
            }
            onProgress?.({ phase: 'analyzing' });
            const cpu = await this.runCli(prepared.wavPath, options, signal, 'cpu', undefined, onProgress);
            return { intervals: cpu.intervals, backend: 'cpu', fallbackUsed: false };
        } finally {
            await prepared.cleanup();
        }
    }

    private async runCli(wavPath: string, options: SpeakerAnalysisOptions, signal: AbortSignal, backend: 'cpu' | 'cuda', cudaRoot?: string | null, onProgress?: (progress: SpeakerAnalysisProgress) => void, verifyCuda = false): Promise<CliResult> {
        const root = this.bundleRoot();
        const binDir = backend === 'cuda' ? cudaRoot : path.join(root, 'cpu', process.platform === 'darwin' ? 'bin' : '');
        if (!binDir) throw new Error('CUDA speaker component is not ready');
        const binary = path.join(binDir, CLI);
        const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'finelistener-sherpa-'));
        try {
            await Promise.all([
                stageLocalFile(path.join(root, 'models', 'segmentation.onnx'), path.join(work, 'segmentation.onnx')),
                stageLocalFile(path.join(root, 'models', 'embedding.onnx'), path.join(work, 'embedding.onnx')),
                stageLocalFile(wavPath, path.join(work, 'audio.wav')),
            ]);
            const stages = ['segmentation', 'embedding'] as const;
            const args = [
                '--segmentation.pyannote-model=segmentation.onnx',
                '--embedding.model=embedding.onnx',
                options.speakerCount === undefined ? '--clustering.cluster-threshold=0.5' : `--clustering.num-clusters=${options.speakerCount}`,
            ];
            for (const stage of stages) {
                if (verifyCuda) {
                    const config = path.join(work, `${stage}.config`);
                    await fsp.writeFile(config, `ProfilingFilePrefix=${stage}-profile\n`, 'utf8');
                    args.push(`--${stage}.provider=${backend}:${stage}.config`);
                } else args.push(`--${stage}.provider=${backend}`);
            }
            args.push('audio.wav');
            const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
            const env = process.platform === 'win32' ? {
                ...process.env,
                PATH: [binDir, path.join(systemRoot, 'System32'), systemRoot].join(path.delimiter),
            } : process.env;
            onProgress?.({ phase: 'analyzing', percent: 0 });
            const output = await runSpeakerProcess(binary, args, signal, work, env,
                (percent) => onProgress?.({ phase: 'analyzing', percent }));
            if (!output.stdout.includes('Started')) throw new Error(`Sherpa returned no result marker: ${output.stderr}`);
            const intervals = parseSpeakerIntervals(output.stdout, options.startSec, options.endSec);
            const gpuStages = { segmentation: false, embedding: false };
            if (verifyCuda) {
                const files = await fsp.readdir(work);
                for (const stage of stages) {
                    const profiles = files.filter((name) => name.startsWith(`${stage}-profile`) && name.endsWith('.json'));
                    for (const profile of profiles) {
                        const events = await readJson<Array<{ cat?: string; args?: { provider?: string } }>>(path.join(work, profile));
                        if (events.some((event) => event.cat === 'Node' && event.args?.provider === 'CUDAExecutionProvider')) {
                            gpuStages[stage] = true;
                        }
                    }
                }
            }
            return { intervals, gpuStages };
        } finally {
            await fsp.rm(work, { recursive: true, force: true });
        }
    }
}
