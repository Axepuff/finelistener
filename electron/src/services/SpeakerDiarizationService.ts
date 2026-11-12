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
import { analyzeNemotron, NEMOTRON_COMPONENT, verifyNemotronGpu, type NemotronAnalysisResult } from './NemotronDiarizer';
import { runSpeakerProcess, SpeakerAnalysisError } from './speakerProcess';

const VERSION = 'community-1-pyannote4-torch28-r1';

export interface SpeakerAnalysisOptions {
    startSec: number;
    endSec?: number;
    speakerCount?: number;
    preferCuda?: boolean;
}

interface CommunityAnalysisResult {
    engine?: 'pyannote-community-1';
    intervals: SessionSpeakerInterval[];
    backend: 'cpu' | 'cuda';
    fallbackUsed: boolean;
    regularIntervals?: SessionSpeakerInterval[];
    modelRevision?: string;
    runtimeRevision?: string;
}

export type SpeakerAnalysisResult = CommunityAnalysisResult | NemotronAnalysisResult;

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

interface ComponentBase {
    version: string;
    variant: 'win-x64-cpu' | 'win-x64-gpu' | 'mac-arm64';
    url: string;
    bytes: number;
    sha256: string;
    files: Record<string, FileEntry>;
    modelRevision: string;
    parts?: Array<{ url: string; bytes: number; sha256: string }>;
}

interface CommunityComponent extends ComponentBase {
    version: typeof VERSION;
    python: string;
}

interface NemotronComponent extends ComponentBase {
    version: typeof NEMOTRON_COMPONENT.version;
    executable: string;
    model: string;
    runtimeRevision: string;
    runtimeSha256: string;
}

type ComponentManifest = CommunityComponent | NemotronComponent;

const isWithin = (root: string, candidate: string): boolean => {
    const relative = path.relative(root, candidate);
    return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

const validFileEntries = (value: unknown): value is Record<string, FileEntry> => {
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).every(([name, entry]) => {
        const file = entry as FileEntry;
        return Boolean(name) && !path.isAbsolute(name) && !name.includes('\\') && !name.includes(':') && !name.split('/').some((part) => part === '..' || part === '')
            && Number.isSafeInteger(file?.bytes) && file.bytes >= 0 && /^[a-f0-9]{64}$/i.test(file.sha256);
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

const hashFile = async (filePath: string, signal?: AbortSignal): Promise<string> => {
    const hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(filePath, { signal })) hash.update(chunk as Buffer);
    return hash.digest('hex');
};

const verifiedFileHashes = new Map<string, { size: number; mtime: number; ctime: number; hash: string }>();

const filesMatch = async (root: string, entries: Record<string, FileEntry>, hash: boolean, signal?: AbortSignal): Promise<boolean> => {
    for (const [name, entry] of Object.entries(entries)) {
        signal?.throwIfAborted();
        const target = path.resolve(root, name);
        if (!isWithin(root, target)) return false;
        try {
            const stat = await fsp.lstat(target);
            if (!stat.isFile() || stat.size !== entry.bytes) return false;
            if (hash) {
                const cached = verifiedFileHashes.get(target);
                const digest = cached && cached.size === stat.size && cached.mtime === stat.mtimeMs && cached.ctime === stat.ctimeMs ?
                    cached.hash : await hashFile(target, signal);
                if (digest !== entry.sha256) { verifiedFileHashes.delete(target); return false; }
                verifiedFileHashes.set(target, { size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs, hash: digest });
            }
        } catch {
            return false;
        }
    }
    return true;
};

const safeArchiveEntries = (listing: string, files: Record<string, FileEntry>): boolean => {
    const names = listing.split(/\r?\n/).filter(Boolean);
    if (names.length !== Object.keys(files).length || new Set(names).size !== names.length) return false;
    return names.every((name) => {
        const normalized = name.replace(/\\/g, '/');
        return !normalized.startsWith('/') && !/^[a-z]:/i.test(normalized)
            && !normalized.split('/').some((part) => part === '..' || part === '')
            && Object.hasOwn(files, normalized);
    });
};

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
        if (app.isPackaged) {
            const native = path.join(process.resourcesPath, 'nemotron');
            const community = path.join(process.resourcesPath, 'community');
            return process.platform === 'win32' && (fs.existsSync(native) || !fs.existsSync(community)) ? native : community;
        }
        const variant = process.platform === 'win32' ?
            (process.env.BUILD_VARIANT === 'win-x64-cpu' ? 'win-x64-cpu' : 'win-x64-gpu') : 'mac-arm64';
        return path.join(app.getAppPath(), 'build-assets', variant, variant === 'win-x64-gpu' ? 'nemotron' : 'community');
    }

    private async component(): Promise<ComponentManifest | null> {
        try {
            const manifest = await readJson<ComponentManifest>(path.join(this.bundleRoot(), 'component.json'));
            const expectedPlatform = process.platform === 'win32' ? manifest.variant.startsWith('win-x64-') :
                process.platform === 'darwin' && manifest.variant === 'mac-arm64';
            const native = path.basename(this.bundleRoot()) === 'nemotron';
            const validRuntime = native ? manifest.version === NEMOTRON_COMPONENT.version
                && process.platform === 'win32' && manifest.variant === 'win-x64-gpu'
                && manifest.executable === NEMOTRON_COMPONENT.executable && manifest.model === NEMOTRON_COMPONENT.model
                && manifest.runtimeRevision === NEMOTRON_COMPONENT.runtimeRevision
                && manifest.runtimeSha256 === NEMOTRON_COMPONENT.runtimeSha256
                && manifest.modelRevision === NEMOTRON_COMPONENT.modelRevision
                && manifest.files?.[manifest.model]?.sha256 === NEMOTRON_COMPONENT.modelSha256
                && Object.hasOwn(manifest.files, manifest.executable) && Object.hasOwn(manifest.files, 'bin/ggml-vulkan.dll')
                && Object.hasOwn(manifest.files, 'notices/model-LICENSE') :
                manifest.version === VERSION && Object.hasOwn(manifest.files, manifest.python)
                && Object.hasOwn(manifest.files, 'worker.py') && Object.hasOwn(manifest.files, 'model/config.yaml');
            return validRuntime && expectedPlatform && process.arch === (process.platform === 'darwin' ? 'arm64' : 'x64')
                && Number.isSafeInteger(manifest.bytes) && manifest.bytes > 0 && /^[a-f0-9]{64}$/i.test(manifest.sha256)
                && validFileEntries(manifest.files) && Object.keys(manifest.files).length > 0
                && /^[a-f0-9]{40}$/.test(manifest.modelRevision)
                && manifest.url.startsWith('https://github.com/Axepuff/finelistener/releases/download/v' + app.getVersion() + '/') ? manifest : null;
        } catch { return null; }
    }

    private installedRoot(component: ComponentManifest): string {
        return path.join(app.getPath('userData'), component.version === VERSION ? 'community' : 'nemotron', component.variant + '-' + component.sha256.slice(0, 16));
    }

    private async readyRoot(component: ComponentManifest, signal?: AbortSignal): Promise<string | null> {
        const candidates = [this.installedRoot(component)];
        if (!app.isPackaged) candidates.unshift(path.join(app.getAppPath(), 'build-assets',
            component.version === VERSION ? 'community-runtime' : 'nemotron-runtime', component.variant));
        for (const root of candidates) if (await filesMatch(root, component.files, true, signal)) return root;
        return null;
    }

    public async getAssetStatus(signal?: AbortSignal): Promise<SpeakerAssetStatus> {
        signal?.throwIfAborted();
        const component = await this.component();
        const root = component ? await this.readyRoot(component, signal) : null;
        const ready = Boolean(root);
        if (path.basename(this.bundleRoot()) === 'nemotron') {
            let vulkanAvailable: boolean | undefined;
            if (root) {
                try {
                    const timeout = AbortSignal.timeout(10_000);
                    await verifyNemotronGpu(root, signal ? AbortSignal.any([signal, timeout]) : timeout);
                    vulkanAvailable = true;
                } catch (error) {
                    signal?.throwIfAborted();
                    console.warn('Nemotron GPU check failed', error); vulkanAvailable = false;
                }
            }
            return { engine: 'nemotron-3', ready, vulkanAvailable,
                cpuReady: false, cudaReady: false, cudaAvailable: false,
                downloadBytes: component?.bytes, runtimeRevision: component?.version };
        }
        const gpu = component?.variant === 'win-x64-gpu';
        const driver = process.platform === 'win32' && fs.existsSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'nvcuda.dll'));
        return { engine: 'pyannote-community-1', ready, cpuReady: ready, cudaReady: ready && gpu, cudaAvailable: Boolean(gpu && driver),
            downloadBytes: component?.bytes, runtimeRevision: component?.version };
    }

    public async prepareAssets(_includeCuda: boolean, signal: AbortSignal, onProgress?: (progress: SpeakerPreparationProgress) => void): Promise<void> {
        signal.throwIfAborted();
        const component = await this.component();
        if (!component) throw new SpeakerAnalysisError('SPEAKER_ASSETS_UNAVAILABLE');
        if (await this.readyRoot(component, signal)) return;
        const target = this.installedRoot(component);
        const parent = path.dirname(target);
        await fsp.mkdir(parent, { recursive: true });
        const temporary = await fsp.mkdtemp(path.join(parent, 'install-'));
        const archive = path.join(temporary, 'component.zip');
        const extracted = path.join(temporary, 'extracted');
        try {
            onProgress?.({ downloadedBytes: 0, totalBytes: component.bytes });
            if (component.parts) {
                let completedBytes = 0;
                for (const [index, part] of component.parts.entries()) {
                    if (!Number.isSafeInteger(part.bytes) || part.bytes <= 0 || !/^[a-f0-9]{64}$/.test(part.sha256)) throw new Error('Invalid component part');
                    const partPath = path.join(temporary, 'part-' + index);
                    await download(part.url, partPath, signal, (progress) => onProgress?.({ downloadedBytes: completedBytes + progress.downloadedBytes, totalBytes: component.bytes }));
                    if ((await fsp.stat(partPath)).size !== part.bytes || await hashFile(partPath, signal) !== part.sha256) throw new Error('Component part failed validation');
                    await pipeline(fs.createReadStream(partPath), fs.createWriteStream(archive, { flags: 'a' }), { signal });
                    await fsp.rm(partPath);
                    completedBytes += part.bytes;
                }
                if (completedBytes !== component.bytes) throw new Error('Component part sizes do not match');
            } else await download(component.url, archive, signal, onProgress);
            if ((await fsp.stat(archive)).size !== component.bytes || await hashFile(archive, signal) !== component.sha256) throw new Error('Speaker component integrity check failed');
            await fsp.mkdir(extracted);
            const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : '/usr/bin/tar';
            const listing = await runSpeakerProcess(tar, ['-tf', archive], signal, temporary);
            if (!safeArchiveEntries(listing.stdout, component.files)) throw new Error('Unexpected speaker archive entries');
            const types = await runSpeakerProcess(tar, ['-tvf', archive], signal, temporary, undefined, undefined, 8_000_000);
            if (types.stdout.split(/\r?\n/).filter(Boolean).some((line) => !line.startsWith('-'))) throw new Error('Only regular archive files are allowed');
            await runSpeakerProcess(tar, ['-xf', archive, '-C', extracted], signal, temporary);
            if (!await filesMatch(extracted, component.files, true, signal)) throw new Error('Speaker component files failed validation');
            signal.throwIfAborted();
            const backup = target + '.previous-' + randomUUID();
            let previous = false;
            try { await fsp.rename(target, backup); previous = true; }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
            try { await fsp.rename(extracted, target); }
            catch (error) { if (previous) await fsp.rename(backup, target); throw error; }
            if (previous) await fsp.rm(backup, { recursive: true, force: true });
        } catch (error) {
            signal.throwIfAborted();
            throw new SpeakerAnalysisError('SPEAKER_ASSETS_UNAVAILABLE', { cause: error });
        } finally { await fsp.rm(temporary, { recursive: true, force: true }); }
    }

    public async analyze(audioPath: string, options: SpeakerAnalysisOptions, signal: AbortSignal,
        onProgress?: (progress: SpeakerAnalysisProgress) => void): Promise<SpeakerAnalysisResult> {
        if (!Number.isFinite(options.startSec) || options.startSec < 0
            || (options.endSec !== undefined && (!Number.isFinite(options.endSec) || options.endSec <= options.startSec))
            || (options.speakerCount !== undefined && (!Number.isSafeInteger(options.speakerCount) || options.speakerCount < 1))) throw new Error('Invalid speaker range/count');
        const component = await this.component();
        if (path.basename(this.bundleRoot()) === 'nemotron' && options.speakerCount !== undefined) {
            throw new SpeakerAnalysisError('SPEAKER_COUNT_UNSUPPORTED');
        }
        const root = component && await this.readyRoot(component, signal);
        if (!component || !root) throw new SpeakerAnalysisError('SPEAKER_ASSETS_UNAVAILABLE');
        signal.throwIfAborted();
        onProgress?.({ phase: 'converting' });
        const segment = options.endSec === undefined && options.startSec === 0 ? undefined :
            { start: options.startSec, end: options.endSec ?? Number.MAX_SAFE_INTEGER };
        const prepared = await this.audio.prepareAudioSegmentExactly(audioPath, segment, signal);
        if (component.version === NEMOTRON_COMPONENT.version) {
            try { return await analyzeNemotron(root, prepared.wavPath, signal, onProgress); }
            finally { await prepared.cleanup(); }
        }
        const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'finelistener-community-'));
        try {
            const run = async (backend: 'cpu' | 'cuda', fallbackUsed: boolean): Promise<SpeakerAnalysisResult> => {
                const request = path.join(work, 'request.json');
                await fsp.writeFile(request, JSON.stringify({ protocol: 1, audio: prepared.wavPath, model: path.join(root, 'model'), backend, speakerCount: options.speakerCount }));
                const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
                const env = { ...process.env, PYTHONHOME: undefined, PYTHONPATH: undefined, HF_TOKEN: undefined,
                    HUGGING_FACE_HUB_TOKEN: undefined, HF_HOME: path.join(work, 'hf'),
                    HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', PYANNOTE_METRICS_ENABLED: '0', DO_NOT_TRACK: '1',
                    MPLCONFIGDIR: path.join(work, 'matplotlib'),
                    PATH: process.platform === 'win32' ? [path.join(root, 'python'), path.join(systemRoot, 'System32'), systemRoot].join(path.delimiter) : '/usr/bin:/bin' };
                onProgress?.({ phase: 'analyzing', percent: 0 });
                const output = await runSpeakerProcess(path.join(root, component.python), ['-I', path.join(root, 'worker.py'), request], signal, work, env,
                    (percent) => onProgress?.({ phase: 'analyzing', percent }));
                const result = JSON.parse(output.stdout) as { protocol: number; backend: string; regularIntervals: SessionSpeakerInterval[]; exclusiveIntervals: SessionSpeakerInterval[] };
                const valid = (intervals: SessionSpeakerInterval[]): boolean => Array.isArray(intervals) && intervals.length <= 100000
                    && intervals.every((interval) => Number.isFinite(interval.startSec) && interval.startSec >= 0
                        && Number.isFinite(interval.endSec) && interval.endSec > interval.startSec
                        && (options.endSec === undefined || interval.endSec <= options.endSec - options.startSec + 0.01)
                        && typeof interval.speakerId === 'string' && interval.speakerId.length <= 200);
                if (result.protocol !== 1 || result.backend !== backend || !valid(result.regularIntervals) || !valid(result.exclusiveIntervals)) throw new Error('Invalid Community worker output');
                return { engine: 'pyannote-community-1', intervals: result.exclusiveIntervals, regularIntervals: result.regularIntervals, backend, fallbackUsed,
                    modelRevision: component.modelRevision, runtimeRevision: component.version };
            };
            if (options.preferCuda && component.variant === 'win-x64-gpu') {
                try { return await run('cuda', false); }
                catch (error) {
                    if (signal.aborted || (error as { exitCode?: number }).exitCode !== 42) throw error;
                    console.warn('Community CUDA initialization failed; retrying on CPU', error);
                    onProgress?.({ phase: 'fallback' });
                    return await run('cpu', true);
                }
            }
            return await run('cpu', false);
        } finally { await prepared.cleanup(); await fsp.rm(work, { recursive: true, force: true }); }
    }
}
