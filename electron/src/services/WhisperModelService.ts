import fs from 'fs';
import fsPromises from 'fs/promises';
import https from 'https';
import path from 'path';
import type { IncomingMessage } from 'http';
import { pipeline } from 'stream/promises';
import type { WhisperModelDownloadProgress, WhisperModelInfo, WhisperModelName } from '../types/whisper';
import {
    getModelDownloadUrl,
    getModelFileName,
    getModelSizeLabel,
    getUserModelsDir,
    getWhisperModelNames,
    isModelAvailable,
    isModelBundled,
} from '../utils/whisper';

type ProgressHandler = (progress: WhisperModelDownloadProgress) => void;

export class WhisperModelService {
    private activeDownload: { name: WhisperModelName; controller: AbortController; promise: Promise<void> } | null = null;

    public listModels(): WhisperModelInfo[] {
        return getWhisperModelNames().map((name) => ({
            name,
            sizeLabel: getModelSizeLabel(name),
            isDownloaded: isModelAvailable(name),
            isBundled: isModelBundled(name),
        }));
    }

    public async importModelFromFile(sourcePath: string): Promise<{ path: string; fileName: string }> {
        if (!sourcePath || typeof sourcePath !== 'string') {
            throw new Error('Invalid model path');
        }

        const ext = path.extname(sourcePath).toLowerCase();

        if (!['.bin', '.gguf'].includes(ext)) {
            throw new Error('Unsupported model file. Expected .bin or .gguf');
        }

        const stat = await fsPromises.stat(sourcePath);

        if (!stat.isFile()) {
            throw new Error('Selected model path is not a file');
        }

        const modelsDir = getUserModelsDir();

        await fsPromises.mkdir(modelsDir, { recursive: true });

        const originalBaseName = path.basename(sourcePath);
        const safeBaseName = originalBaseName || `whisper-model${ext}`;
        const targetPath = await pickAvailableTargetPath(path.join(modelsDir, safeBaseName));

        await fsPromises.copyFile(sourcePath, targetPath);

        return { path: targetPath, fileName: path.basename(targetPath) };
    }

    public async downloadModel(name: WhisperModelName, onProgress?: ProgressHandler): Promise<void> {
        if (isModelAvailable(name)) {
            return;
        }

        if (this.activeDownload?.name === name) return this.activeDownload.promise;
        if (this.activeDownload) throw new Error('A model download is already in progress.');

        const url = getModelDownloadUrl(name);

        if (!url) {
            throw new Error(`Download URL is not configured for model "${name}"`);
        }

        const modelsDir = getUserModelsDir();
        const fileName = getModelFileName(name);
        const targetPath = path.join(modelsDir, fileName);
        const controller = new AbortController();
        const downloadPromise = downloadToFile(url, targetPath, controller.signal, (progress) => {
            onProgress?.({ ...progress, name });
        }).finally(() => {
            this.activeDownload = null;
        });

        this.activeDownload = { name, controller, promise: downloadPromise };

        return downloadPromise;
    }

    public async cancelDownload(name: WhisperModelName): Promise<void> {
        const active = this.activeDownload;
        if (active?.name !== name) return;
        active.controller.abort();
        try { await active.promise; } catch (error) {
            if (!active.controller.signal.aborted) throw error;
        }
    }
}

const downloadToFile = async (
    url: string,
    targetPath: string,
    signal: AbortSignal,
    onProgress?: (progress: Omit<WhisperModelDownloadProgress, 'name'>) => void,
): Promise<void> => {
    await fsPromises.mkdir(path.dirname(targetPath), { recursive: true });

    const tempPath = `${targetPath}.download`;

    await fsPromises.rm(tempPath, { force: true });

    try {
        const response = await openDownload(url, signal);
        const length = Number(response.headers['content-length']);
        const totalBytes = Number.isFinite(length) && length > 0 ? length : null;
        let downloadedBytes = 0;
        response.on('data', (chunk: Buffer) => {
            downloadedBytes += chunk.length;
            onProgress?.({ downloadedBytes, totalBytes, percent: totalBytes ? Math.min(100, Math.round(downloadedBytes / totalBytes * 100)) : null });
        });
        await pipeline(response, fs.createWriteStream(tempPath), { signal });
        signal.throwIfAborted();
        await fsPromises.rename(tempPath, targetPath);
    } catch (error) {
        await fsPromises.rm(tempPath, { force: true });
        throw error;
    }
};

const openDownload = async (url: string, signal: AbortSignal, redirects = 0): Promise<IncomingMessage> => {
    signal.throwIfAborted();
    if (redirects > 10) throw new Error('Too many model download redirects.');
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
        https.get(url, { signal }, resolve).on('error', reject);
    });
    if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        return openDownload(new URL(response.headers.location, url).href, signal, redirects + 1);
    }
    if (response.statusCode !== 200) {
        response.resume();
        throw new Error(`Model download failed (HTTP ${response.statusCode ?? 'unknown'}).`);
    }
    return response;
};

const pickAvailableTargetPath = async (preferredPath: string): Promise<string> => {
    const dir = path.dirname(preferredPath);
    const ext = path.extname(preferredPath);
    const base = path.basename(preferredPath, ext);

    for (let attempt = 0; attempt < 100; attempt += 1) {
        const candidate = attempt === 0 ?
            preferredPath :
            path.join(dir, `${base}-${attempt}${ext}`);

        try {
            await fsPromises.access(candidate, fs.constants.F_OK);
        } catch {
            return candidate;
        }
    }

    throw new Error('Failed to choose a target file name for the imported model');
};
