import fs from 'fs';
import fsPromises from 'fs/promises';
import https from 'https';
import path from 'path';
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
    private readonly activeDownloads = new Map<WhisperModelName, Promise<void>>();

    public listModels(): WhisperModelInfo[] {
        return getWhisperModelNames().map((name) => ({
            name,
            sizeLabel: getModelSizeLabel(name),
            isDownloaded: isModelAvailable(name),
            isBundled: isModelBundled(name),
        }));
    }

    public async downloadModel(name: WhisperModelName, onProgress?: ProgressHandler): Promise<void> {
        if (isModelAvailable(name)) {
            return;
        }

        const existing = this.activeDownloads.get(name);

        if (existing) {
            return existing;
        }

        const url = getModelDownloadUrl(name);

        if (!url) {
            throw new Error(`Download URL is not configured for model "${name}"`);
        }

        const modelsDir = getUserModelsDir();
        const fileName = getModelFileName(name);
        const targetPath = path.join(modelsDir, fileName);
        const downloadPromise = downloadToFile(url, targetPath, (progress) => {
            onProgress?.({ ...progress, name });
        }).finally(() => {
            this.activeDownloads.delete(name);
        });

        this.activeDownloads.set(name, downloadPromise);

        return downloadPromise;
    }
}

const downloadToFile = async (
    url: string,
    targetPath: string,
    onProgress?: (progress: Omit<WhisperModelDownloadProgress, 'name'>) => void,
): Promise<void> => {
    await fsPromises.mkdir(path.dirname(targetPath), { recursive: true });

    const tempPath = `${targetPath}.download`;

    await fsPromises.rm(tempPath, { force: true });

    await new Promise<void>((resolve, reject) => {
        const handleError = (error: Error) => {
            void fsPromises.rm(tempPath, { force: true }).finally(() => reject(error));
        };

        const request = https.get(url, (response) => {
            if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                response.resume();
                void downloadToFile(response.headers.location, targetPath, onProgress).then(resolve).catch(reject);
                return;
            }

            if (response.statusCode !== 200) {
                response.resume();
                handleError(new Error(`Failed to download model from ${url} (status ${response.statusCode ?? 'unknown'})`));
                return;
            }

            const totalHeader = response.headers['content-length'];
            const totalBytes = totalHeader ? Number(totalHeader) : null;
            const total = Number.isFinite(totalBytes) && totalBytes && totalBytes > 0 ? totalBytes : null;
            let downloadedBytes = 0;

            const fileStream = fs.createWriteStream(tempPath);

            response.on('data', (chunk: Buffer) => {
                downloadedBytes += chunk.length;
                const percent = total ? Math.min(100, Math.round((downloadedBytes / total) * 100)) : null;

                onProgress?.({
                    percent,
                    downloadedBytes,
                    totalBytes: total,
                });
            });

            response.on('error', (error) => {
                fileStream.destroy();
                handleError(error);
            });

            fileStream.on('error', (error) => {
                response.destroy();
                handleError(error);
            });

            fileStream.on('finish', () => {
                fileStream.close(() => {
                    void fsPromises.rename(tempPath, targetPath).then(resolve).catch(reject);
                });
            });

            response.pipe(fileStream);
        });

        request.on('error', handleError);
    });
};
