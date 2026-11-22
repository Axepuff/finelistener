import fs from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import https from 'https';
import { PassThrough } from 'stream';
import { EventEmitter } from 'events';
import type { IncomingMessage, ClientRequest } from 'http';
import { afterEach, expect, it, vi } from 'vitest';
import { WhisperModelService } from './WhisperModelService';

const paths = vi.hoisted(() => ({ directory: '' }));
vi.mock('../utils/whisper', () => ({
    getUserModelsDir: () => paths.directory,
    getModelFileName: (name: string) => `${name}.bin`,
    getModelDownloadUrl: () => 'https://models.example/start',
    isModelAvailable: () => false,
}));
let directory = '';
afterEach(async () => { if (directory) await fs.rm(directory, { recursive: true, force: true }); });

const prepare = async () => { directory = await fs.mkdtemp(path.join(tmpdir(), 'finelistener-model-')); paths.directory = directory; };
const response = (statusCode: number, headers = {}): PassThrough & IncomingMessage => Object.assign(new PassThrough(), { statusCode, headers }) as unknown as PassThrough & IncomingMessage;

it('cancels a redirected stream, removes its partial file, blocks overlap, and allows a clean retry', async () => {
    await prepare();
    const body = response(200, { 'content-length': '8' });
    let redirected!: () => void;
    const received = new Promise<void>((resolve) => { redirected = resolve; });
    let attempt = 0;
    vi.spyOn(https, 'get').mockImplementation(((_url: string, options: { signal: AbortSignal }, callback: (message: IncomingMessage) => void) => {
        const request = new EventEmitter();
        options.signal.addEventListener('abort', () => body.destroy(new Error('Aborted')), { once: true });
        queueMicrotask(() => {
            attempt += 1;
            if (attempt === 1) { const redirect = response(302, { location: '/weights' }); callback(redirect); redirect.end(); }
            else if (attempt === 2) { callback(body); body.write('part'); redirected(); }
            else { const ready = response(200, { 'content-length': '8' }); callback(ready); ready.end('complete'); }
        });
        return request as ClientRequest;
    }) as typeof https.get);
    const service = new WhisperModelService();
    const download = service.downloadModel('large');
    const rejected = expect(download).rejects.toThrow();
    await received;
    await expect(service.downloadModel('small')).rejects.toThrow('already in progress');
    await service.cancelDownload('large');
    await rejected;
    expect(await fs.readdir(directory)).toEqual([]);
    await service.downloadModel('large');
    expect(await fs.readFile(path.join(directory, 'large.bin'), 'utf8')).toBe('complete');
    expect(await fs.readdir(directory)).toEqual(['large.bin']);
});

it('does not publish a failed HTTP response as a model and retries successfully', async () => {
    await prepare();
    let attempt = 0;
    vi.spyOn(https, 'get').mockImplementation(((_url: string, _options: unknown, callback: (message: IncomingMessage) => void) => {
        queueMicrotask(() => {
            const reply = response(++attempt === 1 ? 503 : 200);
            callback(reply); reply.end(attempt === 1 ? 'unavailable' : 'weights');
        });
        return new EventEmitter() as ClientRequest;
    }) as typeof https.get);
    const service = new WhisperModelService();
    await expect(service.downloadModel('small')).rejects.toThrow('HTTP 503');
    expect(await fs.readdir(directory)).toEqual([]);
    await service.downloadModel('small');
    expect(await fs.readFile(path.join(directory, 'small.bin'), 'utf8')).toBe('weights');
});
