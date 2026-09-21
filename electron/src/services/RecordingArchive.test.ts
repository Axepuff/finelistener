import fs from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WAV_FORMAT } from './AudioPreprocessor';
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
        expect(second.session.tracks?.map((track) => track.source)).toEqual(['system']);
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
        expect(result.session.tracks?.map((track) => track.source)).toEqual(['system']);
        expect(result.sourceWarnings).toEqual([expect.objectContaining({ source: 'microphone' })]);
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
        const archive = new RecordingArchive({ recoveryQuotaBytes: 1 });
        const prepared = await archive.prepareCapture(undefined, DEFAULT_WAV_FORMAT);
        await fs.writeFile(prepared.outputPath, wav());
        const items = await archive.listRecoverable();
        expect(items).toEqual([expect.objectContaining({ recordingId: prepared.recordingId, state: 'recoverable' })]);
        await expect(archive.prepareCapture(undefined, DEFAULT_WAV_FORMAT)).rejects.toThrow('storage is full');
    });
});
