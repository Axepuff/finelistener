import { createHash } from 'crypto';
import fs from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import type { IpcMain } from 'electron';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { registerSummaryController } from '../controllers/summaryController';
import type { SessionSummary, SessionTranscriptV1, SummaryGenerationResult } from '../types/sessions';
import { defaultRecordingSummaryOptions, recordingSummaryGenerationVersion } from '../types/summaryOptions';
import { generateLocalSummary, SUMMARY_MODEL } from './localSummary';
import { generateRecordingNotes } from './recordingNotes';
import { SessionsService } from './SessionsService';

const environment = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({ app: { getPath: () => environment.root }, shell: {} }));
// Replace only native inference; chunking, controller, source checks and disk persistence are real.
vi.mock('./localSummary', () => ({ generateLocalSummary: vi.fn(), SUMMARY_MODEL: 'Controlled local model' }));

let transcriptPath: string;
let service: SessionsService;
let generate: (event: undefined, id: string, options?: typeof defaultRecordingSummaryOptions) => Promise<SummaryGenerationResult>;
const newLines: string[] = [];
const reviewedText = 'Reviewed garden note.\nInternal  spacing stays.';

beforeEach(async () => {
    environment.root = await fs.mkdtemp(path.join(tmpdir(), 'finelistener-summary-provenance-'));
    const dir = path.join(environment.root, 'sessions', 'speech');
    await fs.mkdir(path.join(dir, 'audio'), { recursive: true });
    // A tiny real WAV allows offline getSession without conversion or a model installation.
    const wav = Buffer.alloc(46);
    wav.write('RIFF'); wav.writeUInt32LE(38, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24);
    wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(2, 40);
    await fs.writeFile(path.join(dir, 'audio', 'source-original-v1.wav'), wav);
    await fs.writeFile(path.join(dir, 'session.json'), JSON.stringify({
        version: 1, id: 'speech', createdAt: 1, updatedAt: 2, title: 'Speech', sourceKind: 'imported', audioMode: 'original',
        audio: { originalPath: 'audio/source-original-v1.wav', wavPath: 'audio/source-original-v1.wav', originalFileName: 'original.wav' },
    }));
    transcriptPath = path.join(dir, 'transcript', 'transcript.v1.json');
    service = new SessionsService();
    const handle = vi.fn();
    registerSummaryController({ handle } as unknown as IpcMain, () => null, service, () => false,
        () => Promise.resolve('controlled-inference-no-model-file'));
    generate = handle.mock.calls.find(([channel]) => channel === 'sessions:generate-summary')![1] as typeof generate;
    newLines.length = 0;
    vi.mocked(generateLocalSummary).mockImplementation((rows, _model, _signal, progress, onReviewed, cached, hint, options) =>
        generateRecordingNotes(rows, {
            countTokens: (text) => Promise.resolve(Array.from(text).length),
            complete: (prompt) => {
                const body = prompt.split('<|im_start|>user\n')[1].split('\n<|im_end|>')[0];
                if (body.includes('NEW LINES\n')) newLines.push(body.split('NEW LINES\n')[1]);
                return Promise.resolve(body.includes('LINES\n') ? reviewedText : 'Garden notes.');
            },
        }, progress, onReviewed, cached, hint, options));
});

afterEach(async () => { await fs.rm(environment.root, { recursive: true, force: true }); });

const transcriptFixture = (labelled = true): SessionTranscriptV1 => ({
    version: 1, recognitionRevision: 'recognition',
    segments: [
        { id: 'last', startSec: 20, endSec: 21, text: 'Closing garden note.', speakerId: null },
        { id: 'shared', source: 'system', startSec: 1, endSec: 8,
            text: ' \t' + 'Garden 🌱 e\u0301\u00a0 \twork.\r\n'.repeat(550) + '  ', speakerId: 'a' },
        { id: 'shared', source: 'microphone', startSec: 1, endSec: 8, text: 'Same time, another source.', speakerId: 'missing' },
        { startSec: 10, endSec: 11, text: 'Unidentified voice.', speakerId: 'u' },
    ],
    ...(labelled ? { speakers: { version: 1, recognitionRevision: 'recognition', generation: 'g', settings: {},
        speakers: [{ id: 'a', name: ' Alice ' }, { id: 'u', name: 'Unknown speaker' }],
        intervals: [], corrections: [], status: 'completed' } } : {}),
});

it.each([
    { chunkCount: 0, labelled: true, unassigned: false },
    { chunkCount: 12, labelled: true, unassigned: false },
    { chunkCount: 12, labelled: false, unassigned: false },
    { chunkCount: 0, labelled: false, unassigned: true },
])('persists exact NEW LINES ranges and historical speakers through offline reopen ($chunkCount, labels=$labelled, unassigned=$unassigned)', async ({ chunkCount, labelled, unassigned }) => {
    const transcript = transcriptFixture(labelled);
    if (unassigned) {
        for (const segment of transcript.segments) delete segment.speakerId;
    }
    await service.saveTranscript('speech', transcript, { language: 'en' });
    const before = Date.now();
    const result = await generate(undefined, 'speech', { ...defaultRecordingSummaryOptions, chunkCount });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    const summary = result.summary;
    const chunks = summary.reviewedChunks!;
    expect(chunks.length).toBeGreaterThan(2);
    expect(Buffer.from(summary.detailed)).toEqual(Buffer.from(chunks.map((chunk) => chunk.text).join('\n\n')));
    expect(chunks.every((chunk) => chunk.text === reviewedText)).toBe(true);
    expect(chunks.every((chunk) => chunk.title === 'Garden notes.')).toBe(true);
    // Each card resolves only NEW LINES. Overlap must never add another reference.
    for (const [index, chunk] of chunks.entries()) {
        expect(chunk.sourceRefs).toBeDefined();
        const resolved = chunk.sourceRefs!.map((ref) => {
            const segment = transcript.segments[ref.segmentIndex];
            expect(ref.segmentId).toBe(segment.id);
            expect(ref.source).toBe(segment.source);
            const text = segment.text.slice(ref.startChar, ref.endChar).replace(/\s+/gu, ' ');
            expect(text.isWellFormed()).toBe(true);
            const speaker = labelled ? segment.speakerId === 'a' ? 'Alice' : 'Unknown speaker' : undefined;
            return `[${segment.startSec.toFixed(2)}–${segment.endSec!.toFixed(2)}] ${speaker ? speaker + ': ' : ''}${text}`;
        }).join('\n');
        expect(newLines[index]).toBe(resolved);
    }
    for (const [index, segment] of transcript.segments.entries()) {
        const refs = chunks.flatMap((chunk) => chunk.sourceRefs!).filter((ref) => ref.segmentIndex === index);
        expect(refs[0].startChar).toBe(segment.text.length - segment.text.trimStart().length);
        expect(refs.at(-1)!.endChar).toBe(segment.text.trimEnd().length);
        for (let i = 1; i < refs.length; i++) expect(refs[i].startChar).toBe(refs[i - 1].endChar);
        expect(refs.map((ref) => segment.text.slice(ref.startChar, ref.endChar)).join('')).toBe(segment.text.trim());
    }
    const speakers = chunks.flatMap((chunk) => chunk.speakers!);
    expect(speakers).toContainEqual({ id: unassigned ? null : 'a', name: labelled ? 'Alice' : null });
    expect(speakers).toContainEqual({ id: unassigned ? null : 'missing', name: null });
    expect(speakers).toContainEqual({ id: null, name: null });
    expect(speakers).toContainEqual({ id: unassigned ? null : 'u', name: labelled ? 'Unknown speaker' : null });
    expect(summary.generatedAt).toBeGreaterThanOrEqual(before);
    expect(summary.generatedAt).toBeLessThanOrEqual(Date.now());
    const reopened = new SessionsService();
    const calls = vi.mocked(generateLocalSummary).mock.calls.length;
    expect((await reopened.getSession('speech')).transcript?.summary).toEqual(summary);
    expect((await reopened.readSummaryInput('speech')).saved).toEqual(summary);
    expect(vi.mocked(generateLocalSummary).mock.calls.length).toBe(calls);
});

it.each(['whitespace', 'id', 'source', 'speaker-id', 'same-time-order'] as const)('drops stale offsets on both read paths and writes after a %s-only source edit', async (edit) => {
    const transcript = transcriptFixture();
    if (edit === 'same-time-order') {
        transcript.segments[1].text = 'The garden work is complete.';
        transcript.segments[2] = { ...transcript.segments[1], source: 'microphone' };
    }
    await service.saveTranscript('speech', transcript, { language: 'en' });
    const result = await generate(undefined, 'speech');
    if (!result.ok) throw new Error(result.reason);
    const original = result.summary;
    const stored = JSON.parse(await fs.readFile(transcriptPath, 'utf8')) as SessionTranscriptV1;
    if (edit === 'whitespace') stored.segments[1].text = stored.segments[1].text.replaceAll('\r\n', '\n');
    if (edit === 'id') stored.segments[1].id = 'new-id';
    if (edit === 'source') stored.segments[1].source = 'microphone';
    if (edit === 'speaker-id') stored.segments[2].speakerId = 'other-unlabelled-id';
    if (edit === 'same-time-order') [stored.segments[1], stored.segments[2]] = [stored.segments[2], stored.segments[1]];
    // Simulate an external edit bypassing writeTranscript to exercise read-time protection too.
    await fs.writeFile(transcriptPath, JSON.stringify(stored));
    const reopened = new SessionsService();
    const input = await reopened.readSummaryInput('speech');
    expect(input.inputHash).toBe(original.inputHash);
    expect(input.sourceRevision).not.toBe(original.sourceRevision);
    const readable = (await reopened.getSession('speech')).transcript?.summary;
    expect(readable).toEqual(input.saved);
    expect(readable?.sourceRevision).toBeUndefined();
    expect(readable?.reviewedChunks?.every((chunk) => !chunk.sourceRefs)).toBe(true);
    expect(readable).toMatchObject({ brief: original.brief, detailed: original.detailed, generatedAt: original.generatedAt });
    expect(readable?.reviewedChunks?.map((chunk) => chunk.speakers)).toEqual(original.reviewedChunks?.map((chunk) => chunk.speakers));
    await expect(reopened.saveSummary('speech', original, new AbortController().signal)).rejects.toThrow('The transcript changed');
    await reopened.saveTranscript('speech', stored);
    const persisted = JSON.parse(await fs.readFile(transcriptPath, 'utf8')) as SessionTranscriptV1;
    expect(persisted.summary).toEqual(readable);
    if (edit === 'whitespace') {
        const linesBeforeRetry = newLines.length;
        await reopened.saveSummary('speech', { ...readable!, brief: '' }, new AbortController().signal);
        const retry = await generate(undefined, 'speech');
        if (!retry.ok) throw new Error(retry.reason);
        expect(retry.summary.reviewedChunks).toEqual(readable?.reviewedChunks);
        expect(retry.summary.sourceRevision).toBeUndefined();
        expect(newLines).toHaveLength(linesBeforeRetry);
    }
});

it('keeps legacy hashes, results and brief caches without backfilling source metadata or dates', async () => {
    const transcript: SessionTranscriptV1 = { version: 1, segments: [{ startSec: 0, endSec: 1, text: 'Saved speech.' }] };
    await service.saveTranscript('speech', transcript, { language: 'en' });
    const inputHash = createHash('sha256').update(JSON.stringify([undefined, [{ startSec: 0, endSec: 1, text: 'Saved speech.' }]])).digest('hex');
    expect((await service.readSummaryInput('speech')).inputHash).toBe(inputHash);
    const legacy: SessionSummary = { inputHash, model: SUMMARY_MODEL, brief: 'Legacy brief.', detailed: reviewedText,
        generationVersion: recordingSummaryGenerationVersion, options: defaultRecordingSummaryOptions,
        reviewedChunks: [{ startSec: 0, endSec: 1, text: reviewedText }] };
    await service.saveSummary('speech', legacy, new AbortController().signal);
    const reopened = new SessionsService();
    expect((await reopened.getSession('speech')).transcript?.summary).toEqual(legacy);
    expect((await reopened.readSummaryInput('speech')).saved).toEqual(legacy);
    expect(newLines).toEqual([]);
    await service.saveSummary('speech', { ...legacy, brief: '' }, new AbortController().signal);
    expect((await new SessionsService().getSession('speech')).transcript?.summary).toEqual({ ...legacy, brief: '' });
    const beforeRetry = Date.now();
    const result = await generate(undefined, 'speech');
    if (!result.ok) throw new Error(result.reason);
    expect(result.summary.detailed).toBe(legacy.detailed);
    expect(result.summary.reviewedChunks).toEqual(legacy.reviewedChunks);
    expect(result.summary.sourceRevision).toBeUndefined();
    expect(result.summary.generatedAt).toBeGreaterThanOrEqual(beforeRetry);
    expect(newLines).toEqual([]);
    // A rejected legacy cache really regenerates from current rows and must receive fresh provenance.
    await service.saveSummary('speech', { ...legacy, brief: '',
        reviewedChunks: [{ startSec: 0, endSec: 1, text: 'Обсудили сад.' }] }, new AbortController().signal);
    const regenerated = await generate(undefined, 'speech');
    if (!regenerated.ok) throw new Error(regenerated.reason);
    expect(newLines).not.toEqual([]);
    expect(regenerated.summary.sourceRevision).toBe((await service.readSummaryInput('speech')).sourceRevision);
    expect(regenerated.summary.reviewedChunks?.[0].sourceRefs).toEqual([{ segmentIndex: 0, startChar: 0, endChar: 13 }]);
});
