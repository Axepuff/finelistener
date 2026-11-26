import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
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
