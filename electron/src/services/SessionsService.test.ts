import fs from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SessionSourceRun } from '../types/sessions';
import { SessionsService } from './SessionsService';
import { SessionSpeakerWorkflow } from './SessionSpeakerWorkflow';

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
    const systemPath = path.join(environment.root, 'recordings', 'system.wav');
    const microphonePath = path.join(environment.root, 'recordings', 'microphone.wav');
    await fs.mkdir(path.dirname(systemPath), { recursive: true });
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
    expect(session.audioMode).toBe('optimized');
    expect(await fs.readFile(session.audioOriginalPath)).toEqual(wav(1000));
    expect(session.audioOptimizedWavPath).toBeTruthy();
});

it('persists reversible duplicate-filter presentations without changing source results', async () => {
    const sourcePath = path.join(environment.root, 'source.wav');
    await fs.writeFile(sourcePath, wav(1000));
    const service = new SessionsService();
    const session = await service.createSessionFromImport(sourcePath);
    const duplicated = 'This system phrase contains enough words for duplicate filtering';
    const sourceRun: SessionSourceRun = {
        status: 'completed',
        settings: { language: 'en' },
        sources: [
            {
                source: 'system',
                status: 'completed',
                segments: [{ source: 'system', startSec: 1, endSec: 3, text: duplicated }],
            },
            {
                source: 'microphone',
                status: 'completed',
                segments: [{
                    source: 'microphone',
                    startSec: 1.2,
                    endSec: 3.2,
                    text: `${duplicated}, local reply.`,
                }],
            },
        ],
    };
    await service.saveTranscript(session.id, {
        version: 1,
        segments: sourceRun.sources.flatMap((source) => source.segments),
        sourceRun,
    }, { language: 'en', model: 'base' });

    const filtered = await service.setTranscriptDuplicateFilter(session.id, true);
    expect(filtered.transcript?.segments.map((item) => [item.source, item.text])).toEqual([
        ['system', duplicated],
        ['microphone', 'local reply.'],
    ]);
    expect(filtered.transcript?.sourceRun).toMatchObject(sourceRun);

    const restored = await new SessionsService().setTranscriptDuplicateFilter(session.id, false);
    expect(restored.transcript?.segments.map((item) => item.text)).toEqual([
        duplicated,
        `${duplicated}, local reply.`,
    ]);
    const manifest = JSON.parse(await fs.readFile(
        path.join(environment.root, 'sessions', session.id, 'session.json'),
        'utf8',
    )) as { transcription?: unknown };
    expect(manifest.transcription).toEqual({ language: 'en', model: 'base' });
});

it.each([undefined, null, { wavPath: 42 }, { wavPath: 'cache.wav' }])('opens a valid session alongside a malformed audio manifest: %j', async (audio) => {
    const sessionDir = path.join(environment.root, 'sessions', 'valid');
    const brokenDir = path.join(environment.root, 'sessions', 'broken');
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.mkdir(brokenDir, { recursive: true });
    await fs.writeFile(path.join(sessionDir, 'original.wav'), wav(1000));
    await fs.writeFile(path.join(sessionDir, 'session.json'), JSON.stringify({
        version: 1, id: 'valid', title: 'Recording', createdAt: 1, updatedAt: 1, sourceKind: 'recorded',
        audio: { originalFileName: 'original.wav', originalPath: 'original.wav' },
    }));
    await fs.writeFile(path.join(brokenDir, 'session.json'), JSON.stringify({ version: 1, audio }));

    await expect(new SessionsService().getSession('valid')).resolves.toMatchObject({
        id: 'valid', audioMode: 'optimized', audioOriginalPath: path.join(sessionDir, 'original.wav'),
    });
});

it('does not publish a broken session or remove originals when mixing fails', async () => {
    const source = path.join(environment.root, 'recordings', 'invalid.wav');
    await fs.mkdir(path.dirname(source), { recursive: true });
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

it('rejects recording files outside managed storage before creating a session', async () => {
    const source = path.join(environment.root, 'outside.wav');
    await fs.mkdir(path.join(environment.root, 'recordings'));
    await fs.writeFile(source, wav(1000));
    const service = new SessionsService();
    await expect(service.createSessionFromRecordingFile(source)).rejects.toThrow('outside managed storage');
    await expect(fs.readFile(source)).resolves.toEqual(wav(1000));
    await expect(service.listSessions()).resolves.toEqual([]);
});

it('rejects a symlink in managed recording storage without touching its target', async () => {
    const recordings = path.join(environment.root, 'recordings');
    const external = path.join(environment.root, 'external.wav');
    const link = path.join(recordings, 'linked.wav');
    await fs.mkdir(recordings); await fs.writeFile(external, wav(3000));
    try { await fs.symlink(external, link, 'file'); }
    catch { return; }
    const service = new SessionsService();
    await expect(service.createSessionFromRecordingFile(link)).rejects.toThrow('Invalid recording file');
    await expect(fs.readFile(external)).resolves.toEqual(wav(3000));
});

it('evicts least recently used derived audio and regenerates it on demand', async () => {
    const firstSource = path.join(environment.root, 'first.wav');
    const secondSource = path.join(environment.root, 'second.wav');
    await fs.writeFile(firstSource, wav(1000)); await fs.writeFile(secondSource, wav(2000));
    const service = new SessionsService(40_000);
    const first = await service.createSessionFromImport(firstSource);
    await service.setActiveSession(first.id);
    const second = await service.createSessionFromImport(secondSource);
    await expect(fs.access(first.audioWavPath)).resolves.toBeUndefined();
    await service.setActiveSession(second.id);
    await expect(fs.access(first.audioWavPath)).rejects.toThrow();
    await expect(fs.access(second.audioWavPath)).resolves.toBeUndefined();
    const reopened = await service.getSession(first.id);
    await expect(fs.access(reopened.audioWavPath)).resolves.toBeUndefined();
    await expect(fs.readFile(reopened.audioOriginalPath)).resolves.toEqual(wav(1000));
});

it('does not allow the sessions API to delete the staging root', async () => {
    const stagingFile = path.join(environment.root, 'sessions', '.staging', 'recording', 'audio.wav');
    await fs.mkdir(path.dirname(stagingFile), { recursive: true });
    await fs.writeFile(stagingFile, wav(1000));

    const service = new SessionsService();
    await expect(service.deleteSession('.staging')).rejects.toThrow('Invalid session id');
    await expect(fs.access(stagingFile)).resolves.toBeUndefined();
});

it('rebuilds cache accounting when the derived cache index is missing', async () => {
    const firstSource = path.join(environment.root, 'first-rebuild.wav');
    const secondSource = path.join(environment.root, 'second-rebuild.wav');
    await fs.writeFile(firstSource, wav(1000));
    await fs.writeFile(secondSource, wav(2000));

    const initialService = new SessionsService(Number.MAX_SAFE_INTEGER);
    const first = await initialService.createSessionFromImport(firstSource);
    const second = await initialService.createSessionFromImport(secondSource);
    await fs.rm(path.join(environment.root, 'sessions', '.derived-cache.json'), { force: true });

    const enforcingService = new SessionsService(40_000);
    await enforcingService.setActiveSession(second.id);

    await expect(fs.access(first.audioWavPath)).rejects.toThrow();
    await expect(fs.access(first.audioOriginalPath)).resolves.toBeUndefined();
    await expect(fs.access(second.audioWavPath)).resolves.toBeUndefined();
});

it('publishes speaker replacement only for the same recognition and active session generation', async () => {
    const source = path.join(environment.root, 'speaker-source.wav');
    await fs.writeFile(source, wav(1000));
    const service = new SessionsService();
    const session = await service.createSessionFromImport(source);
    const original = { version: 1 as const, segments: [{ startSec: 0, endSec: 1, text: 'first' }] };
    await service.saveTranscript(session.id, original);
    await service.setActiveSession(session.id);
    const fingerprint = service.recognitionFingerprint(original);
    const activeGeneration = service.getActiveSessionGeneration();
    await service.saveTranscript(session.id, { ...original, segments: [{ ...original.segments[0], text: 'new ASR' }] });
    expect(await service.replaceTranscriptIfCurrent(session.id, fingerprint, original)).toBe(false);
    expect((await service.getSession(session.id)).transcript?.segments[0].text).toBe('new ASR');

    const current = (await service.getSession(session.id)).transcript!;
    await service.setActiveSession(null);
    await service.setActiveSession(session.id);
    expect(await service.replaceTranscriptIfCurrent(
        session.id, service.recognitionFingerprint(current), original, undefined, activeGeneration,
    )).toBe(false);
    expect((await service.getSession(session.id)).transcript?.segments[0].text).toBe('new ASR');
});

it('preserves a duplicate-filter change made during speaker analysis of a legacy transcript', async () => {
    const source = path.join(environment.root, 'speaker-filter-source.wav');
    await fs.writeFile(source, wav(1000));
    const service = new SessionsService();
    const session = await service.createSessionFromImport(source);
    const original = { version: 1 as const, segments: [], sourceRun: {
        status: 'completed' as const, settings: { language: 'en' },
        sources: [{ source: 'system' as const, status: 'completed' as const,
            segments: [{ startSec: 0, endSec: 1, text: 'hello' }] }],
    } };
    await service.saveTranscript(session.id, original);
    await service.setActiveSession(session.id);
    const fingerprint = service.recognitionFingerprint(original);
    await service.setTranscriptDuplicateFilter(session.id, false);
    const replacement = { ...original, speakers: {
        version: 1 as const, recognitionRevision: (await service.getSession(session.id)).transcript!.recognitionRevision!,
        generation: 'generation', settings: {},
        intervals: [{ startSec: 0, endSec: 1, speakerId: 'generation:one' }],
        speakers: [{ id: 'generation:one', name: 'Speaker 1' }], corrections: [], status: 'completed' as const,
    } };

    expect(await service.replaceTranscriptIfCurrent(session.id, fingerprint, replacement)).toBe(true);
    const saved = (await service.getSession(session.id)).transcript!;
    expect(saved.presentation?.duplicateFilter?.enabled).toBe(false);
    expect(saved.segments[0].speakerId).toBe('generation:one');
});

it('persists Original across reopen and reuses per-source Optimized without changing original samples or transcripts', async () => {
    const source = path.join(environment.root, 'selected.wav');
    await fs.writeFile(source, wav(1000));
    const service = new SessionsService();
    const created = await service.createSessionFromImport(source);
    expect(created.audioMode).toBe('optimized');
    const first = await service.prepareSourceAudio(created.audioOriginalPath, 'optimized');
    const before = await fs.stat(first);
    expect(await service.prepareSourceAudio(created.audioOriginalPath, 'optimized')).toBe(first);
    expect((await fs.stat(first)).mtimeMs).toBe(before.mtimeMs);
    await service.saveTranscript(created.id, { version: 1, segments: [{ startSec: 0, endSec: 1, text: 'Saved' }] });
    await service.optimizeSessionAudio(created.id, 'original');
    const reopened = await new SessionsService().getSession(created.id);
    expect(reopened.audioMode).toBe('original');
    expect(reopened.transcript?.segments[0].text).toBe('Saved');
    expect(await fs.readFile(reopened.audioOriginalPath)).toEqual(wav(1000));
    const signal = AbortSignal.abort();
    await expect(service.prepareSourceAudio(created.audioOriginalPath, 'optimized', signal)).rejects.toThrow();
});

it('rejects an invalid group member and stale generation without partially persisting valid members', async () => {
    const source = path.join(environment.root, 'group.wav');
    await fs.writeFile(source, wav(1000));
    const service = new SessionsService();
    const session = await service.createSessionFromImport(source);
    await service.setActiveSession(session.id);
    const raw = [{ id: 'a', startSec: 0, endSec: 0.5, text: 'One' }, { id: 'b', startSec: 0.5, endSec: 1, text: 'Two' }];
    await service.saveTranscript(session.id, { version: 1, recognitionRevision: 'r', segments: raw, recognitionSegments: raw,
        speakers: { version: 1, recognitionRevision: 'r', generation: 'g', settings: {}, intervals: [],
            speakers: [{ id: 'g:0', name: 'One' }], corrections: [], status: 'completed' } });
    const workflow = new SessionSpeakerWorkflow(service, { getAssetStatus: () => Promise.resolve({ cpuReady: false, cudaReady: false, cudaAvailable: false }),
        prepareAssets: () => Promise.resolve(), analyze: () => Promise.resolve({ intervals: [], backend: 'cpu', fallbackUsed: false }) }, () => undefined);
    const first = { segmentId: 'a', startChar: 0, endChar: 3 };
    const second = { segmentId: 'b', startChar: 0, endChar: 3 };
    await expect(workflow.assign(session.id, { recognitionRevision: 'r', generation: 'g', spans: [first, { ...second, endChar: 20 }] }, 'g:0')).rejects.toThrow();
    expect((await service.getSession(session.id)).transcript?.speakers?.corrections).toEqual([]);
    await expect(workflow.assign(session.id, { recognitionRevision: 'r', generation: 'old', spans: [first, second] }, 'g:0')).rejects.toThrow();
    const saved = await workflow.assign(session.id, { recognitionRevision: 'r', generation: 'g', spans: [first, second] }, 'g:0');
    expect(saved.transcript?.speakers?.corrections).toEqual([{ ...first, speakerId: 'g:0' }, { ...second, speakerId: 'g:0' }]);
});

it('persists merges to and from Unknown speaker without changing recognition or future unassignments', async () => {
    const source = path.join(environment.root, 'unknown-speakers.wav');
    await fs.writeFile(source, wav(1000));
    const service = new SessionsService();
    const session = await service.createSessionFromImport(source);
    await service.setActiveSession(session.id);
    const raw = ['First', 'Second', 'Unresolved', 'Corrected', 'Last'].map((text, index) => ({
        id: `raw-${index}`, startSec: index, endSec: index + 1, text,
    }));
    await service.saveTranscript(session.id, { version: 1, recognitionRevision: 'r', segments: raw, recognitionSegments: raw,
        speakers: { version: 1, recognitionRevision: 'r', generation: 'g', settings: {},
            intervals: [
                { startSec: 0, endSec: 1, speakerId: 'a' },
                { startSec: 1, endSec: 2, speakerId: 'b' },
                { startSec: 3, endSec: 4, speakerId: 'a' },
                { startSec: 4, endSec: 5, speakerId: 'c' },
            ],
            speakers: [{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }, { id: 'c', name: 'Carol' }],
            corrections: [{ segmentId: 'raw-3', startChar: 0, endChar: 9, speakerId: null }], status: 'completed' } });
    const workflow = new SessionSpeakerWorkflow(service, { getAssetStatus: vi.fn(), prepareAssets: vi.fn(), analyze: vi.fn() }, () => undefined);

    await workflow.merge(session.id, 'a', 'b');
    const unassigned = await workflow.merge(session.id, 'b', null);
    expect(unassigned.transcript?.segments.map((segment) => segment.speakerId)).toEqual([null, null, null, null, 'c']);
    expect(unassigned.transcript?.speakers?.speakers).toEqual([{ id: 'c', name: 'Carol' }]);
    await workflow.merge(session.id, null, 'c');
    const reopened = await new SessionsService().getSession(session.id);
    expect(reopened.transcript?.segments.map((segment) => segment.speakerId)).toEqual(['c', 'c', 'c', 'c', 'c']);
    expect(reopened.transcript?.recognitionSegments).toEqual(raw);
    await workflow.assign(session.id, { segmentId: 'raw-0', startChar: 0, endChar: 5 }, null);
    const renamed = await workflow.rename(session.id, 'c', 'Carol renamed');
    expect(renamed.transcript?.segments.map((segment) => segment.speakerId)).toEqual([null, 'c', 'c', 'c', 'c']);
});

it('includes hidden duplicate speech when merging Unknown speaker', async () => {
    const source = path.join(environment.root, 'hidden-speakers.wav');
    await fs.writeFile(source, wav(1000));
    const service = new SessionsService();
    const session = await service.createSessionFromImport(source);
    await service.setActiveSession(session.id);
    const text = 'please open the document';
    await service.saveTranscript(session.id, { version: 1, recognitionRevision: 'r', segments: [], sourceRun: {
        status: 'completed', settings: { language: 'en' }, sources: [
            { source: 'system', status: 'completed', segments: [{ id: 'system', startSec: 0, endSec: 1, text }] },
            { source: 'microphone', status: 'completed', segments: [{ id: 'microphone', startSec: 0, endSec: 1, text }] },
        ],
    }, speakers: { version: 1, recognitionRevision: 'r', generation: 'g', settings: {}, intervals: [],
        speakers: [{ id: 'a', name: 'Alice' }, { id: 'g:microphone', name: 'Microphone' }],
        corrections: [{ segmentId: 'microphone', startChar: 0, endChar: text.length, speakerId: null }], status: 'completed' } });
    const filtered = await service.setTranscriptDuplicateFilter(session.id, true);
    expect(filtered.transcript?.segments.map((segment) => segment.source)).toEqual(['system']);
    const workflow = new SessionSpeakerWorkflow(service, { getAssetStatus: vi.fn(), prepareAssets: vi.fn(), analyze: vi.fn() }, () => undefined);

    const merged = await workflow.merge(session.id, null, 'a');
    expect(merged.transcript?.presentation?.duplicateFilter?.enabled).toBe(true);
    const unfiltered = await service.setTranscriptDuplicateFilter(session.id, false);
    expect(Object.fromEntries(unfiltered.transcript!.segments.map((segment) => [segment.source, segment.speakerId])))
        .toEqual({ microphone: 'a', system: 'a' });
});
