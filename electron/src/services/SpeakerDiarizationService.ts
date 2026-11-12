import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import https from 'https';
import path from 'path';
import { pipeline } from 'stream/promises';
import { app } from 'electron';
import type { SpeakerAssetStatus, SpeakerCompute } from '../types/transcription';
import { AudioPreprocessor } from './AudioPreprocessor';
import { analyzeNemotron, NEMOTRON_COMPONENT, NEMOTRON_RUNTIMES, inspectNemotron, type NemotronAnalysisResult, type NemotronVariant } from './NemotronDiarizer';
import { runSpeakerProcess, SpeakerAnalysisError } from './speakerProcess';

export interface SpeakerAnalysisOptions {
    startSec: number;
    endSec?: number;
    speakerCount?: number;
    compute?: SpeakerCompute;
}

export type SpeakerAnalysisResult = NemotronAnalysisResult;

export interface SpeakerPreparationProgress {
    downloadedBytes: number;
    totalBytes?: number;
}

export interface SpeakerAnalysisProgress {
    phase: 'converting' | 'analyzing';
    percent?: number;
}

interface FileEntry {
    bytes: number;
    sha256: string;
}

interface ComponentManifest {
    version: string;
    variant: NemotronVariant;
    url: string;
    bytes: number;
    sha256: string;
    files: Record<string, FileEntry>;
    modelRevision: string;
    executable: string;
    model: string;
    runtimeRevision: string;
    runtimeSha256: string;
}

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
        if (app.isPackaged) return path.join(process.resourcesPath, 'nemotron');
        const variant = process.platform === 'win32' ?
            (process.env.BUILD_VARIANT === 'win-x64-cpu' ? 'win-x64-cpu' : 'win-x64-gpu') : 'mac-arm64';
        return path.join(app.getAppPath(), 'build-assets', variant, 'nemotron');
    }

    private async component(): Promise<ComponentManifest | null> {
        try {
            const manifest = await readJson<ComponentManifest>(path.join(this.bundleRoot(), 'component.json'));
            const runtime = NEMOTRON_RUNTIMES[manifest.variant];
            const expectedPlatform = process.platform === 'win32' ? manifest.variant.startsWith('win-x64-') :
                process.platform === 'darwin' && manifest.variant === 'mac-arm64';
            return runtime && expectedPlatform && process.arch === (process.platform === 'darwin' ? 'arm64' : 'x64')
                && manifest.version === NEMOTRON_COMPONENT.version
                && manifest.executable === runtime.executable && manifest.model === NEMOTRON_COMPONENT.model
                && manifest.runtimeRevision === runtime.revision && manifest.runtimeSha256 === runtime.sha256
                && manifest.modelRevision === NEMOTRON_COMPONENT.modelRevision
                && validFileEntries(manifest.files)
                && manifest.files[manifest.model]?.sha256 === NEMOTRON_COMPONENT.modelSha256
                && Object.hasOwn(manifest.files, manifest.executable) && Object.hasOwn(manifest.files, 'notices/model-LICENSE')
                && Number.isSafeInteger(manifest.bytes) && manifest.bytes > 0 && /^[a-f0-9]{64}$/i.test(manifest.sha256)
                && manifest.url === 'https://github.com/Axepuff/finelistener/releases/download/v' + app.getVersion() +
                    '/finelistener-' + manifest.version + '-' + manifest.variant + '.zip' ? manifest : null;
        } catch { return null; }
    }

    private installedRoot(component: ComponentManifest): string {
        return path.join(app.getPath('userData'), 'nemotron', component.variant + '-' + component.sha256.slice(0, 16));
    }

    private async readyRoot(component: ComponentManifest, signal?: AbortSignal): Promise<string | null> {
        const candidates = [this.installedRoot(component)];
        if (!app.isPackaged) candidates.unshift(path.join(app.getAppPath(), 'build-assets',
            'nemotron-runtime', component.variant));
        for (const root of candidates) if (await filesMatch(root, component.files, true, signal)) return root;
        return null;
    }

    public async getAssetStatus(signal?: AbortSignal): Promise<SpeakerAssetStatus> {
        signal?.throwIfAborted();
        const component = await this.component();
        const root = component ? await this.readyRoot(component, signal) : null;
        let ready = Boolean(root);
        let gpuAvailable: boolean | undefined;
        if (root && component) {
            try {
                const timeout = AbortSignal.timeout(10_000);
                ({ gpuAvailable } = await inspectNemotron(root, component.variant,
                    signal ? AbortSignal.any([signal, timeout]) : timeout));
            } catch (error) {
                signal?.throwIfAborted();
                console.warn('Nemotron runtime check failed', error);
                ready = false;
            }
        }
        return { ready, gpuAvailable, gpuBackend: component ? NEMOTRON_RUNTIMES[component.variant].gpuBackend : null,
            downloadBytes: component?.bytes, runtimeRevision: component?.runtimeRevision };
    }

    public async prepareAssets(signal: AbortSignal, onProgress?: (progress: SpeakerPreparationProgress) => void): Promise<void> {
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
            await download(component.url, archive, signal, onProgress);
            if ((await fsp.stat(archive)).size !== component.bytes || await hashFile(archive, signal) !== component.sha256) throw new Error('Speaker component integrity check failed');
            await fsp.mkdir(extracted);
            const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : '/usr/bin/tar';
            // Windows tar can use an ANSI argv code page. Keep paths relative to the Unicode-safe process cwd.
            const listing = await runSpeakerProcess(tar, ['-tf', 'component.zip'], signal, temporary);
            if (!safeArchiveEntries(listing.stdout, component.files)) throw new Error('Unexpected speaker archive entries');
            const types = await runSpeakerProcess(tar, ['-tvf', 'component.zip'], signal, temporary, undefined, 8_000_000);
            if (types.stdout.split(/\r?\n/).filter(Boolean).some((line) => !line.startsWith('-'))) throw new Error('Only regular archive files are allowed');
            await runSpeakerProcess(tar, ['-xf', 'component.zip', '-C', 'extracted'], signal, temporary);
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
        if (options.compute !== undefined && !['auto', 'cpu', 'gpu'].includes(options.compute)) throw new Error('Invalid speaker compute mode');
        const component = await this.component();
        if (options.speakerCount !== undefined) {
            throw new SpeakerAnalysisError('SPEAKER_COUNT_UNSUPPORTED');
        }
        const root = component && await this.readyRoot(component, signal);
        if (!component || !root) throw new SpeakerAnalysisError('SPEAKER_ASSETS_UNAVAILABLE');
        signal.throwIfAborted();
        onProgress?.({ phase: 'converting' });
        const segment = options.endSec === undefined && options.startSec === 0 ? undefined :
            { start: options.startSec, end: options.endSec ?? Number.MAX_SAFE_INTEGER };
        const prepared = await this.audio.prepareAudioSegmentExactly(audioPath, segment, signal);
        try { return await analyzeNemotron(root, component.variant, options.compute ?? 'auto', prepared.wavPath, signal, onProgress); }
        finally { await prepared.cleanup(); }
    }
}
