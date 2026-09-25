import fs from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioPreprocessor, DEFAULT_WAV_FORMAT } from './AudioPreprocessor';
import { RecordingArchive } from './RecordingArchive';
import { SessionsService } from './SessionsService';

const environment = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({
    app: { getPath: () => environment.root },
    shell: { openPath: () => Promise.resolve('') },
}));

const wav = (): Buffer => {
    const dataSize = 16000 * 2;
    const buffer = Buffer.alloc(44 + dataSize);
    buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataSize, 4); buffer.write('WAVEfmt ', 8);
    buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(16000, 24); buffer.writeUInt32LE(32000, 28); buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(dataSize, 40);
    return buffer;
};

describe('RecordingArchive', () => {
    beforeEach(async () => { environment.root = await fs.mkdtemp(path.join(tmpdir(), 'finelistener-archive-test-')); });
    afterEach(async () => { await fs.rm(environment.root, { recursive: true, force: true }); });

    it('publishes valid sources transactionally and makes repeated recovery idempotent', async () => {
        const archive = new RecordingArchive({ sessionsService: new SessionsService() });
        const prepared = await archive.prepareCapture({ system: '', microphone: null }, DEFAULT_WAV_FORMAT);
        await fs.writeFile(prepared.outputPath, wav());
        await archive.registerCaptureResult(prepared.recordingId, { filePath: prepared.outputPath, format: DEFAULT_WAV_FORMAT });
        const first = await archive.finalize(prepared.recordingId);
        const second = await archive.recover(prepared.recordingId);
        expect(second.sessionId).toBe(first.sessionId);
        const session = await new SessionsService().getSession(second.sessionId);
        expect(session.tracks?.map((track) => track.source)).toEqual(['system']);
        await expect(fs.access(path.join(environment.root, 'recordings', 'pending', prepared.recordingId))).rejects.toThrow();
    });

    it('keeps a valid source when another source is invalid', async () => {
        const archive = new RecordingArchive({ sessionsService: new SessionsService() });
        const prepared = await archive.prepareCapture({ system: '', microphone: '' }, DEFAULT_WAV_FORMAT);
        const microphonePath = path.join(path.dirname(prepared.outputPath), 'microphone.wav');
        await fs.writeFile(prepared.outputPath, wav()); await fs.writeFile(microphonePath, 'broken');
        await archive.registerCaptureResult(prepared.recordingId, {
            filePath: prepared.outputPath, format: DEFAULT_WAV_FORMAT,
            tracks: [{ source: 'system', filePath: prepared.outputPath }, { source: 'microphone', filePath: microphonePath }],
        });
        const result = await archive.finalize(prepared.recordingId);
        const session = await new SessionsService().getSession(result.sessionId);
        expect(session.tracks?.map((track) => track.source)).toEqual(['system']);
        expect(result.sourceWarnings).toEqual([{
            source: 'microphone',
            message: 'This audio source could not be recovered.',
        }]);
    });

    it('rejects a capture path outside the owned recording directory', async () => {
        const archive = new RecordingArchive();
        const prepared = await archive.prepareCapture(undefined, DEFAULT_WAV_FORMAT);
        const external = path.join(environment.root, 'outside.wav'); await fs.writeFile(external, wav());
        await expect(archive.registerCaptureResult(prepared.recordingId, {
            filePath: external, format: DEFAULT_WAV_FORMAT,
        })).rejects.toThrow('outside its recording directory');
        expect((await archive.listRecoverable()).some((item) => item.recordingId === prepared.recordingId)).toBe(true);
    });

    it('marks an interrupted capture recoverable and enforces the recovery quota', async () => {
        const captureArchive = new RecordingArchive();
        const prepared = await captureArchive.prepareCapture(undefined, DEFAULT_WAV_FORMAT);
        await fs.writeFile(prepared.outputPath, wav());
        const archive = new RecordingArchive({ recoveryQuotaBytes: 1 });
        const items = await archive.listRecoverable();
        expect(items).toEqual([expect.objectContaining({ recordingId: prepared.recordingId, state: 'recoverable' })]);
        await expect(archive.prepareCapture(undefined, DEFAULT_WAV_FORMAT)).rejects.toThrow('storage is full');
    });

    it('does not expose or delete a capture that is still active', async () => {
        const archive = new RecordingArchive();
        const prepared = await archive.prepareCapture(undefined, DEFAULT_WAV_FORMAT);
        await fs.writeFile(prepared.outputPath, wav());

        await expect(archive.listRecoverable()).resolves.toEqual([]);
        await expect(archive.discard(prepared.recordingId)).rejects.toThrow('active recording');
        await expect(archive.discard(prepared.recordingId.toUpperCase())).rejects.toThrow('active recording');
        await expect(archive.discard(`unknown-pending:${prepared.recordingId}`)).rejects.toThrow('active recording');

        archive.markCaptureStopped(prepared.recordingId);
        await expect(archive.discard(`unknown-pending:${prepared.recordingId}`)).rejects.toThrow('unknown recording id');
        await expect(archive.listRecoverable()).resolves.toEqual([
            expect.objectContaining({ recordingId: prepared.recordingId, state: 'recoverable' }),
        ]);
    });

    it('deletes a recoverable recording after finalization moved it into staging', async () => {
        const audioPreprocessor = {
            mixSources: vi.fn(() => Promise.reject(new Error('mix failed'))),
        } as unknown as AudioPreprocessor;
        const archive = new RecordingArchive({ audioPreprocessor });
        const prepared = await archive.prepareCapture(undefined, DEFAULT_WAV_FORMAT);
        await fs.writeFile(prepared.outputPath, wav());
        await archive.registerCaptureResult(prepared.recordingId, {
            filePath: prepared.outputPath,
            format: DEFAULT_WAV_FORMAT,
        });

        await expect(archive.finalize(prepared.recordingId)).rejects.toThrow('mix failed');
        await expect(archive.listRecoverable()).resolves.toEqual([
            expect.objectContaining({ recordingId: prepared.recordingId, state: 'recoverable' }),
        ]);

        await archive.discard(prepared.recordingId);
        await expect(archive.listRecoverable()).resolves.toEqual([]);
    });

    it('rejects an unsafe session id from a recovery manifest', async () => {
        const archive = new RecordingArchive();
        const prepared = await archive.prepareCapture(undefined, DEFAULT_WAV_FORMAT);
        const recordingDir = path.dirname(path.dirname(prepared.outputPath));
        const manifestPath = path.join(recordingDir, 'recovery.json');
        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>;
        manifest.sessionId = '../../outside';
        await fs.writeFile(manifestPath, JSON.stringify(manifest));
        archive.markCaptureStopped(prepared.recordingId);

        await expect(archive.finalize(prepared.recordingId)).rejects.toThrow('Invalid recovery manifest');
        await expect(fs.access(path.join(environment.root, 'outside'))).rejects.toThrow();
    });

    it('does not allow the legacy discard route to remove the pending root', async () => {
        const archive = new RecordingArchive();
        const prepared = await archive.prepareCapture(undefined, DEFAULT_WAV_FORMAT);

        await expect(archive.discard('legacy:pending')).rejects.toThrow('Invalid recording id');
        await expect(fs.access(path.dirname(path.dirname(prepared.outputPath)))).resolves.toBeUndefined();
    });
});
