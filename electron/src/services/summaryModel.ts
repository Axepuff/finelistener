import { createHash } from 'crypto';
import { createReadStream, type BigIntStats } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { net } from 'electron';
import { SUMMARY_MODEL_ARTIFACT, type SummaryModelStatus } from '../types/summaryModel';

const artifact = SUMMARY_MODEL_ARTIFACT;
export const SUMMARY_MODEL_FILE = artifact.fileName;
const url = `https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/${artifact.revision}/${artifact.fileName}?download=true`;
const promptFileName = /^prompt-[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}\.txt$/u;
const fileStamp = (info: BigIntStats): string => `${info.dev}/${info.ino}/${info.mtimeNs}/${info.ctimeNs}`;

function status(state: SummaryModelStatus['state'], downloadedBytes = 0, error?: SummaryModelStatus['error']): SummaryModelStatus {
    return { state, model: artifact.name, totalBytes: artifact.bytes, downloadedBytes, ...(error && { error }) };
}

export class SummaryModelService {
    private readonly file: string;
    private readonly shutdown = new AbortController();
    private readonly promptCleanup: Promise<void>;
    private verifiedStamp: string | undefined;
    private current = status('missing');
    private activeDownload: Promise<SummaryModelStatus> | null = null;

    constructor(private readonly directory: string, private readonly onChange: (value: SummaryModelStatus) => void) {
        this.file = path.join(directory, artifact.fileName);
        // A previous process may have exited with transcript text still on disk.
        this.promptCleanup = fs.readdir(directory, { withFileTypes: true })
            .then(async (entries) => {
                const prompts = entries.filter((entry) => entry.isFile() && promptFileName.test(entry.name));
                await Promise.all(prompts.map((entry) => fs.rm(path.join(directory, entry.name), { force: true })));
            })
            .catch((error: NodeJS.ErrnoException) => {
                if (error.code !== 'ENOENT') console.warn('Could not clean up interrupted summary prompts', error);
            });
    }

    private async isInstalled(signal: AbortSignal): Promise<boolean> {
        signal.throwIfAborted();
        const info = await fs.stat(this.file, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return undefined;
            throw error;
        });
        if (!info?.isFile() || info.size !== BigInt(artifact.bytes)) return false;
        const stamp = fileStamp(info);
        if (this.verifiedStamp === stamp) return true;
        const hash = createHash('sha256');
        for await (const bytes of createReadStream(this.file, { signal })) hash.update(bytes as Buffer);
        if (hash.digest('hex') !== artifact.sha256) return false;
        this.verifiedStamp = stamp;
        return true;
    }

    private publish(value: SummaryModelStatus): SummaryModelStatus {
        this.current = value;
        this.onChange(value);
        return value;
    }

    public async getStatus(): Promise<SummaryModelStatus> {
        if (this.activeDownload) return this.current;
        const before = this.current;
        try {
            const installed = await this.isInstalled(this.shutdown.signal);
            // A download or a newer status read may have completed during the file check.
            if (before !== this.current) return this.current;
            if (installed) this.current = status('ready', artifact.bytes);
            else if (before.state !== 'error' || before.error === 'storage') this.current = status('missing');
        } catch (error) {
            if (before === this.current && !this.shutdown.signal.aborted) {
                console.error('Could not inspect the summary model', error);
                this.current = status('error', 0, 'storage');
            }
        }
        return this.current;
    }

    public async requireInstalled(signal: AbortSignal): Promise<string> {
        await this.promptCleanup;
        if (await this.isInstalled(signal)) return this.file;
        throw new Error('SUMMARY_MODEL_MISSING');
    }

    public download(): Promise<SummaryModelStatus> {
        if (this.activeDownload) return this.activeDownload;
        if (this.shutdown.signal.aborted) return Promise.resolve(status('error', 0, 'download'));
        this.activeDownload = this.install(this.shutdown.signal)
            .then(() => this.publish(status('ready', artifact.bytes)))
            .catch((error: unknown) => {
                if (this.shutdown.signal.aborted) return this.publish(status('missing'));
                console.error('Could not install the summary model', error);
                const diskFull = (error as NodeJS.ErrnoException).code === 'ENOSPC';
                return this.publish(status('error', 0, diskFull ? 'disk-space' : 'download'));
            })
            .finally(() => { this.activeDownload = null; });
        this.publish(status('downloading'));
        return this.activeDownload;
    }

    public async stopAndWait(): Promise<void> {
        this.shutdown.abort();
        await Promise.all([this.activeDownload, this.promptCleanup]);
    }

    private async install(signal: AbortSignal): Promise<void> {
        if (await this.isInstalled(signal)) return;
        await fs.mkdir(this.directory, { recursive: true });
        const partial = this.file + '.partial';
        // A previous app process may have exited before removing its incomplete transfer.
        await fs.rm(partial, { force: true });
        const disk = await fs.statfs(this.directory, { bigint: true });
        if (disk.bavail * disk.bsize < BigInt(artifact.bytes)) {
            throw Object.assign(new Error('Insufficient space for the summary model'), { code: 'ENOSPC' });
        }
        try {
            this.verifiedStamp = await this.installVerifiedDownload(partial, signal);
        } finally {
            await fs.rm(partial, { force: true });
        }
    }

    private async installVerifiedDownload(partial: string, signal: AbortSignal): Promise<string> {
        const output = await fs.open(partial, 'wx', 0o600);
        try {
            const response = await net.fetch(url, { signal, credentials: 'omit', cache: 'no-store' });
            if (!response.ok || !response.body) {
                await response.body?.cancel();
                throw new Error(`Summary model download returned HTTP ${response.status}`);
            }
            const hash = createHash('sha256');
            let received = 0;
            let percent = 0;
            await response.body.pipeTo(new WritableStream<Uint8Array>({
                write: async (chunk) => {
                    received += chunk.byteLength;
                    if (received > artifact.bytes) throw new Error('Summary model exceeds its expected size');
                    hash.update(chunk);
                    await output.writeFile(chunk);
                    const next = Math.floor(received * 100 / artifact.bytes);
                    if (next !== percent) {
                        percent = next;
                        this.publish(status('downloading', received));
                    }
                },
            }), { signal });
            if (received !== artifact.bytes || hash.digest('hex') !== artifact.sha256) {
                throw new Error('Summary model failed integrity verification');
            }
            signal.throwIfAborted();
            await fs.rename(partial, this.file);
            // Bind the streamed digest to the installed file handle, even if its path is later replaced.
            return fileStamp(await output.stat({ bigint: true }));
        } finally {
            await output.close();
        }
    }
}
