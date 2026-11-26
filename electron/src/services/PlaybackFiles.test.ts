import nodeFs from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PlaybackFiles } from './PlaybackFiles';

let root: string;
beforeEach(async () => { root = await fs.mkdtemp(path.join(tmpdir(), 'finelistener-playback-')); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

it('closes reads and rejects new requests for the session being deleted', async () => {
    const playback = new PlaybackFiles();
    const session = path.join(root, 'session');
    const otherSession = path.join(root, 'session-2');
    const wav = path.join(session, 'audio.wav');
    const otherWav = path.join(otherSession, 'audio.wav');
    const data = Buffer.alloc(1024 * 1024, 42);
    await fs.mkdir(session);
    await fs.mkdir(otherSession);
    await fs.writeFile(wav, data);
    await fs.writeFile(otherWav, data);
    const request = new Request('local-file://playback/audio.wav', { headers: { Range: 'bytes=10-' } });
    const response = await playback.serve(wav, request);
    const reader = response.body!.getReader();
    const otherReader = (await playback.serve(otherWav, request)).body!.getReader();
    try {
        expect(response.status).toBe(206);
        expect(response.headers.get('Content-Range')).toBe(`bytes 10-${data.length - 1}/${data.length}`);
        await expect(reader.read()).resolves.toMatchObject({ done: false });
        await expect(otherReader.read()).resolves.toMatchObject({ done: false });

        await playback.withFilesReleased(session, async () => {
            await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' });
            expect((await playback.serve(wav, request)).status).toBe(409);
            await expect(otherReader.read()).resolves.toMatchObject({ done: false });
            await fs.rm(session, { recursive: true });
        });
        expect((await playback.serve(wav, request)).status).toBe(404);
    } finally {
        await Promise.allSettled([reader.cancel(), otherReader.cancel()]);
    }
});

it.each(['pending', 'failed-before-delete'] as const)('requires a successful close when release is %s', async (release) => {
    const playback = new PlaybackFiles();
    const wav = path.join(root, 'audio.wav');
    const original = Buffer.alloc(1024 * 1024, 42);
    await fs.writeFile(wav, original);
    const request = new AbortController();
    const response = await playback.serve(wav, new Request('local-file://playback/audio.wav', { signal: request.signal }));
    const reader = response.body!.getReader();
    await expect(reader.read()).resolves.toMatchObject({ done: false });

    const close = Promise.withResolvers<{ fd: number; complete: (error: NodeJS.ErrnoException | null) => void }>();
    vi.spyOn(nodeFs, 'close').mockImplementationOnce((fd, complete) => {
        if (!complete) throw new Error('Expected the playback stream to pass a close callback');
        close.resolve({ fd, complete });
    });
    const remove = vi.fn(async () => fs.unlink(wav));

    if (release === 'failed-before-delete') {
        const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        request.abort();
        const { fd, complete } = await close.promise;
        try {
            complete(Object.assign(new Error('Injected close failure'), { code: 'EIO', syscall: 'close' }));
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(log).toHaveBeenCalledOnce();
            await expect(playback.withFilesReleased(root, remove)).rejects.toThrow('Playback file could not be released.');
            expect(remove).not.toHaveBeenCalled();
            expect((await fs.readFile(wav)).equals(original)).toBe(true);
        } finally {
            await new Promise<void>((resolve, reject) => {
                nodeFs.close(fd, (error) => error ? reject(error) : resolve());
            });
        }
    } else {
        const deletion = playback.withFilesReleased(root, remove);
        const { fd, complete } = await close.promise;
        try {
            expect(remove).not.toHaveBeenCalled();
            expect((await fs.readFile(wav)).equals(original)).toBe(true);
        } finally {
            nodeFs.close(fd, complete);
            await deletion;
        }
        expect(remove).toHaveBeenCalledOnce();
        await expect(fs.access(wav)).rejects.toMatchObject({ code: 'ENOENT' });
    }
});
