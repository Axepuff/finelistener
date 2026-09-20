import fs from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SessionsService } from './SessionsService';

const environment = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({
    app: { getPath: () => environment.root },
    shell: { openPath: () => Promise.resolve('') },
}));

const wav = (amplitude: number): Buffer => {
    const dataSize = 16000 * 2;
    const buffer = Buffer.alloc(44 + dataSize);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVEfmt ', 8);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(16000, 24);
    buffer.writeUInt32LE(32000, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    for (let offset = 44; offset < buffer.length; offset += 2) buffer.writeInt16LE(amplitude, offset);
    return buffer;
};

beforeEach(async () => {
    environment.root = await fs.mkdtemp(path.join(tmpdir(), 'finelistener-session-test-'));
});

afterEach(async () => {
    await fs.rm(environment.root, { recursive: true, force: true });
});

it('persists source originals and reopens a real FFmpeg mix with aligned duration and bounded samples', async () => {
    const systemPath = path.join(environment.root, 'system.wav');
    const microphonePath = path.join(environment.root, 'microphone.wav');
    await fs.writeFile(systemPath, wav(26000));
    await fs.writeFile(microphonePath, wav(-26000));
    const service = new SessionsService();
    const session = await service.createSessionFromRecordingFile({
        filePath: systemPath,
        format: { sampleRateHz: 16000, channels: 1, bitDepth: 16, codec: 'pcm_s16le' },
        tracks: [
            { source: 'system', filePath: systemPath, durationMs: 1000, startOffsetMs: 0 },
            { source: 'microphone', filePath: microphonePath, durationMs: 1000, startOffsetMs: 500 },
        ],
        sourceFailures: [{ source: 'system', message: 'Device disconnected.' }],
    });
    const reopened = await new SessionsService().getSession(session.id);
    expect(reopened.tracks).toHaveLength(2);
    expect(reopened.tracks?.[0].failure).toBe('Device disconnected.');
    expect(await fs.readFile(reopened.tracks![0].filePath)).toEqual(wav(26000));
    const mix = await fs.readFile(reopened.audioWavPath);
    const dataOffset = mix.indexOf(Buffer.from('data'));
    const size = mix.readUInt32LE(dataOffset + 4);
    expect(size / 32000).toBe(1.5);
    const sampleAt = (seconds: number) => mix.readInt16LE(dataOffset + 8 + Math.floor(seconds * 16000) * 2);
    expect(sampleAt(0.25)).toBeGreaterThan(0);
    expect(Math.abs(sampleAt(0.75))).toBeLessThan(2);
    expect(sampleAt(1.25)).toBeLessThan(0);
    for (let offset = dataOffset + 8; offset < dataOffset + 8 + size; offset += 2) {
        expect(Math.abs(mix.readInt16LE(offset))).toBeLessThan(32767);
    }
    await expect(fs.access(systemPath)).rejects.toThrow();
    await service.saveTranscript(session.id, {
        version: 1, segments: [{ startSec: 0, endSec: 1, text: 'Saved', source: 'system' }],
        sourceRun: {
            status: 'incomplete', settings: { language: 'en', segment: { start: 0, end: 1 }, optimized: true },
            sources: [
                { source: 'system', status: 'completed', segments: [{ startSec: 0, endSec: 1, text: 'Saved', source: 'system' }] },
                { source: 'microphone', status: 'failed', segments: [], error: 'Could not transcribe this source.' },
            ],
        },
    });
    const reopenedPartial = await new SessionsService().getSession(session.id);
    expect(reopenedPartial.transcript?.sourceRun?.sources[0].status).toBe('completed');
    expect(reopenedPartial.transcript?.sourceRun?.sources[1].status).toBe('failed');
    expect(reopenedPartial.transcript?.sourceRun?.settings).toEqual({
        language: 'en', segment: { start: 0, end: 1 }, optimized: true,
    });
});

it('opens legacy sessions without assigning invented source labels', async () => {
    const sessionDir = path.join(environment.root, 'sessions', 'legacy');
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(path.join(sessionDir, 'original.wav'), wav(1000));
    await fs.writeFile(path.join(sessionDir, 'session.json'), JSON.stringify({
        version: 1, id: 'legacy', title: 'Old recording', createdAt: 1, updatedAt: 1, sourceKind: 'recorded',
        audio: { originalFileName: 'original.wav', originalPath: 'original.wav' },
    }));
    const session = await new SessionsService().getSession('legacy');
    expect(session.tracks).toBeUndefined();
    expect(session.audioWavPath).toBe(path.join(sessionDir, 'original.wav'));
});

it('does not publish a broken session or remove originals when mixing fails', async () => {
    const source = path.join(environment.root, 'invalid.wav');
    await fs.writeFile(source, 'invalid audio');
    const service = new SessionsService();
    await expect(service.createSessionFromRecordingFile({
        filePath: source,
        format: { sampleRateHz: 16000, channels: 1, bitDepth: 16, codec: 'pcm_s16le' },
        tracks: [{ source: 'system', filePath: source }],
    })).rejects.toThrow();
    await expect(fs.readFile(source, 'utf8')).resolves.toBe('invalid audio');
    await expect(service.listSessions()).resolves.toEqual([]);
});
