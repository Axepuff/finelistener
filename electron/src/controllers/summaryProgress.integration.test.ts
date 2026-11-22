import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { BrowserWindow, IpcMain } from 'electron';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SessionSummary, SessionTranscriptV1, SummaryProgressEvent } from '../types/sessions';
import { defaultRecordingSummaryOptions, recordingSummaryGenerationVersion } from '../types/summaryOptions';
import { generateRecordingNotes, type SummaryInference } from '../services/recordingNotes';
import { generateLocalSummary, SUMMARY_MODEL } from '../services/localSummary';
import { SessionsService } from '../services/SessionsService';
import { registerSummaryController } from './summaryController';

const environment = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({ app: { getPath: () => environment.root }, shell: {} }));
vi.mock('../services/localSummary', () => ({ generateLocalSummary: vi.fn(), SUMMARY_MODEL: 'Local model' }));

const note = 'The speakers discussed the shipment together and agreed to check the final delivery date on Friday.';
const brief = 'The delivery date will be checked Friday.';
const bodyOf = (prompt: string) => prompt.split('<|im_start|>user\n')[1].split('\n<|im_end|>')[0];
let drafts: string[];
let reviews: string[];
let failBrief: boolean;
let failNextCompletion: boolean;
const inference: SummaryInference = {
    countTokens: (text) => Promise.resolve(Array.from(text).length),
    complete: (prompt) => {
        if (failNextCompletion) { failNextCompletion = false; throw new Error('Controlled inference failure'); }
        const body = bodyOf(prompt);
        if (body.includes('NEW LINES\n')) { drafts.push(body); return Promise.resolve(note); }
        if (body.includes('ORIGINAL LINES\n')) { reviews.push(body); return Promise.resolve(note); }
        return Promise.resolve(failBrief ? null : brief);
    },
};

beforeEach(async () => {
    environment.root = await fs.mkdtemp(path.join(os.tmpdir(), 'finelistener-summary-progress-'));
    drafts = []; reviews = []; failBrief = false; failNextCompletion = false;
    vi.mocked(generateLocalSummary).mockClear();
    vi.mocked(generateLocalSummary).mockImplementation((rows, _file, signal, progress, onReviewed, cache, hint, options, resume) =>
        generateRecordingNotes(rows, {
            countTokens: async (text) => { signal.throwIfAborted(); return inference.countTokens(text); },
            complete: async (prompt, limit) => { signal.throwIfAborted(); return inference.complete(prompt, limit); },
        }, progress, onReviewed, cache, hint, options, resume));
});
afterEach(async () => { await fs.rm(environment.root, { recursive: true, force: true }); vi.restoreAllMocks(); });

const transcriptPath = () => path.join(environment.root, 'sessions', 'speech', 'transcript', 'transcript.v1.json');
const readDisk = async () => JSON.parse(await fs.readFile(transcriptPath(), 'utf8')) as SessionTranscriptV1;
const createSession = async (text: string, oldResult = false, multiRow = false) => {
    const dir = path.join(environment.root, 'sessions', 'speech');
    await fs.mkdir(dir, { recursive: true });
    const wav = Buffer.alloc(364);
    wav.write('RIFF'); wav.writeUInt32LE(356, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24);
    wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(320, 40);
    await fs.writeFile(path.join(dir, 'source.wav'), wav);
    await fs.writeFile(path.join(dir, 'session.json'), JSON.stringify({ version: 1, id: 'speech', audioMode: 'original',
        audio: { originalPath: 'source.wav', wavPath: 'source.wav', originalFileName: 'source.wav' } }));
    const sessions = new SessionsService();
    const boundaries = multiRow ? [0, text.indexOf('We discussed', Math.floor(text.length / 3)),
        text.indexOf('We discussed', Math.floor(text.length * 2 / 3)), text.length] : [0, text.length];
    const segments = boundaries.slice(0, -1).map((start, index) => ({ id: `source${index || ''}`,
        startSec: 1 + index * 100, endSec: 90 + index * 100, text: text.slice(start, boundaries[index + 1]),
        speakerId: index === 1 ? null : 'a' }));
    await sessions.saveTranscript('speech', { version: 1, recognitionRevision: 'r', segments, speakers: { version: 1, recognitionRevision: 'r', generation: 'g', settings: {}, status: 'completed',
        speakers: [{ id: 'a', name: 'Alice' }], intervals: [], corrections: [] } });
    const input = await sessions.readSummaryInput('speech');
    if (oldResult) await sessions.saveSummary('speech', {
        brief: 'Previous brief.', detailed: 'Previous detailed.', inputHash: input.inputHash, model: 'Previous model',
    }, new AbortController().signal);
    return sessions;
};

const controller = (sessions: SessionsService, onProgress?: (event: SummaryProgressEvent) => void) => {
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const ipc = { handle: (name: string, fn: (...args: unknown[]) => Promise<unknown>) => handlers.set(name, fn) } as unknown as IpcMain;
    const window = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (channel: string, event: SummaryProgressEvent) => { if (channel === 'sessions:summary-progress') onProgress?.(event); } } } as unknown as BrowserWindow;
    const workflow = registerSummaryController(ipc, () => window, sessions, () => false, () => Promise.resolve('fake.gguf'));
    return { ...workflow, stop: workflow.stopAndWait, generate: (options = defaultRecordingSummaryOptions) => handlers.get('sessions:generate-summary')!(undefined, 'speech', options) };
};

it.each([{ chunkCount: 0, multiRow: false, error: false }, { chunkCount: 4, multiRow: false, error: false },
    { chunkCount: 0, multiRow: true, error: false }, { chunkCount: 3, multiRow: true, error: false },
    { chunkCount: 0, multiRow: false, error: true }])('persists each accepted passage, reopens and continues split speech with identical overlap ($chunkCount, rows=$multiRow, error=$error)', async ({ chunkCount, multiRow, error }) => {
    const text = ('We discussed 🌱 the shipment.\t  ').repeat(420) + 'The final delivery is Friday.';
    const sessions = await createSession(text, true, multiRow);
    const options = { ...defaultRecordingSummaryOptions, chunkCount };
    await expect(controller(sessions).generate(options)).resolves.toMatchObject({ ok: true });
    const expectedDrafts = [...drafts];
    const expectedReviews = [...reviews];
    expect(expectedDrafts.length).toBeGreaterThan(2);
    const initial = await readDisk();
    const completed = initial.summary!;
    const { summaryDraft: _draft, ...clean } = initial;
    await sessions.saveTranscript('speech', { ...clean, summary: { ...completed, brief: 'Previous brief.' } });
    const previous = (await sessions.readSummaryInput('speech')).saved;
    drafts = []; reviews = [];
    let stop: Promise<boolean> | undefined;
    const running = controller(sessions, (event) => {
        if (event.draft?.reviewedChunks.length === 2) {
            if (error) failNextCompletion = true;
            else stop = running.stop();
        }
    });
    if (error) vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(running.generate(options)).resolves.toEqual({ ok: false, reason: error ? 'failed' : 'cancelled' });
    if (!error) await expect(stop).resolves.toBe(true);
    const partial = await readDisk();
    expect(partial.summary).toEqual(previous);
    expect(partial.summaryDraft?.reviewedChunks).toHaveLength(2);
    expect(partial.summaryDraft?.progress.phase).toBe('chunks');
    expect(partial.summaryDraft).not.toHaveProperty('generatedAt');
    expect(partial.summaryDraft).not.toHaveProperty('brief');
    expect(partial.summaryDraft?.reviewedChunks[0].speakers).toEqual([{ id: 'a', name: 'Alice' }]);
    const reopened = new SessionsService();
    expect((await reopened.getSession('speech')).transcript?.summaryDraft).toEqual(partial.summaryDraft);
    await expect(controller(reopened).generate(options)).resolves.toMatchObject({ ok: true });
    expect(drafts).toEqual(expectedDrafts);
    expect(reviews).toEqual(expectedReviews);
    const final = await readDisk();
    expect(final.summaryDraft).toBeUndefined();
    expect(final.summary?.detailed).toBe(final.summary?.reviewedChunks?.map((chunk) => chunk.text).join('\n\n'));
    expect(final.summary?.reviewedChunks?.length).toBe(expectedDrafts.length);
    const refs = final.summary!.reviewedChunks!.flatMap((chunk) => chunk.sourceRefs!);
    for (const [index, segment] of initial.segments.entries()) {
        expect(refs.filter((ref) => ref.segmentIndex === index).map((ref) => segment.text.slice(ref.startChar, ref.endChar))
            .join('').replace(/\s+/gu, ' ')).toBe(segment.text.trim().replace(/\s+/gu, ' '));
    }
    expect(final.summary?.generatedAt).toBeGreaterThan(0);
});

it.each([false, true])('keeps a failed brief separate from the completed result and retries accepted chunks (old=%s)', async (oldResult) => {
    const sessions = await createSession('We discussed the final shipment and promised to confirm delivery on Friday.', oldResult);
    const old = (await sessions.readSummaryInput('speech')).saved;
    failBrief = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(controller(sessions).generate()).resolves.toEqual({ ok: false, reason: 'failed' });
    const partial = await readDisk();
    expect(partial.summary).toEqual(old);
    expect(partial.summaryDraft?.progress.phase).toBe('brief');
    expect(partial.summaryDraft).not.toHaveProperty('generatedAt');
    const accepted = partial.summaryDraft?.reviewedChunks;
    drafts = []; reviews = []; failBrief = false;
    await expect(controller(new SessionsService()).generate()).resolves.toMatchObject({ ok: true });
    expect(drafts).toEqual([]); expect(reviews).toEqual([]);
    const final = await readDisk();
    expect(final.summary?.reviewedChunks).toEqual(accepted);
    expect(final.summaryDraft).toBeUndefined();
});

it.each(['inputHash', 'sourceRevision', 'model', 'prompt', 'chunkCount', 'overlapPercent', 'generationVersion', 'cursor-version',
    'cursor-gap', 'phase', 'sourceRefs', 'speaker-snapshot', 'source-whitespace', 'source-id', 'source-speaker'])('regenerates incompatible progress instead of continuing it (%s)', async (change) => {
    const text = 'We discussed the shipment and its delivery on Friday. '.repeat(130);
    const sessions = await createSession(text, true);
    const running = controller(sessions, (event) => { if (event.draft?.reviewedChunks.length === 1) void running.stop(); });
    await expect(running.generate()).resolves.toMatchObject({ ok: false, reason: 'cancelled' });
    const disk = await readDisk();
    const draft = disk.summaryDraft!;
    switch (change) {
        case 'inputHash': draft.inputHash = 'other'; break;
        case 'sourceRevision': draft.sourceRevision = 'other'; break;
        case 'model': draft.model = 'other'; break;
        case 'prompt': draft.options.prompt = 'Other request.'; break;
        case 'chunkCount': draft.options.chunkCount = 4; break;
        case 'overlapPercent': draft.options.overlapPercent = 20; break;
        case 'generationVersion': draft.generationVersion++; break;
        case 'cursor-version': (draft.progress.version as number)++; break;
        case 'cursor-gap': draft.progress.cursors[0].startChar++; break;
        case 'phase': draft.progress.phase = 'brief'; break;
        case 'sourceRefs': draft.reviewedChunks[0].sourceRefs![0].startChar++; break;
        case 'speaker-snapshot': draft.reviewedChunks[0].speakers![0].name = 'Other'; break;
        case 'source-whitespace': disk.segments[0].text = text.replace(' ', '  '); break;
        case 'source-id': disk.segments[0].id = 'changed'; break;
        case 'source-speaker': disk.speakers!.speakers[0].name = 'Other'; break;
    }
    await fs.writeFile(transcriptPath(), JSON.stringify(disk));
    drafts = []; reviews = [];
    await expect(controller(new SessionsService()).generate()).resolves.toMatchObject({ ok: true });
    expect(drafts.length).toBeGreaterThan(1);
    expect(drafts[0]).toContain('NEW LINES\n[1.00–90.00]');
    expect(drafts[0]).toContain('We discussed the shipment');
    expect((await readDisk()).summaryDraft).toBeUndefined();
});

it('reads legacy completed output offline and retries legacy brief notes without inventing provenance', async () => {
    const sessions = await createSession('The delivery is unconfirmed.', true);
    expect((await new SessionsService().getSession('speech')).transcript?.summary).toMatchObject({ brief: 'Previous brief.' });
    expect((await sessions.readSummaryInput('speech')).saved).not.toHaveProperty('generatedAt');
    expect(generateLocalSummary).not.toHaveBeenCalled();
    const input = await sessions.readSummaryInput('speech');
    const legacy: SessionSummary = { inputHash: input.inputHash, model: SUMMARY_MODEL, options: { ...defaultRecordingSummaryOptions },
        generationVersion: recordingSummaryGenerationVersion, brief: '', detailed: note,
        reviewedChunks: [{ startSec: 1, endSec: 90, text: note }] };
    await sessions.saveSummary('speech', legacy, new AbortController().signal);
    await expect(controller(new SessionsService()).generate()).resolves.toMatchObject({ ok: true });
    expect(drafts).toEqual([]);
    const saved = (await readDisk()).summary!;
    expect(saved.reviewedChunks).toEqual(legacy.reviewedChunks);
    expect(saved).not.toHaveProperty('sourceRevision');
    expect(saved.reviewedChunks![0]).not.toHaveProperty('sourceRefs');
});

it('rejects late draft and completed saves after active session ownership changes', async () => {
    const sessions = await createSession('The delivery is unconfirmed.', true);
    failBrief = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await controller(sessions).generate();
    const disk = await readDisk();
    const draft = disk.summaryDraft!;
    await sessions.setActiveSession('speech');
    const generation = sessions.getActiveSessionGeneration();
    await sessions.setActiveSession(null);
    await expect(sessions.saveSummaryDraft('speech', draft, new AbortController().signal, generation)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(sessions.saveSummary('speech', { ...disk.summary!, brief: 'Late' }, new AbortController().signal, generation)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(sessions.saveSummaryDraft('speech', draft, AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' });
    expect(await readDisk()).toEqual(disk);
});


it.each(['draft', 'completed'])('rechecks ownership immediately before the atomic %s commit', async (kind) => {
    const sessions = await createSession('The delivery remains unconfirmed.', true);
    failBrief = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await controller(sessions).generate();
    const original = await fs.readFile(transcriptPath(), 'utf8');
    const disk = await readDisk();
    await sessions.setActiveSession('speech');
    const generation = sessions.getActiveSessionGeneration();
    const write = fs.writeFile.bind(fs);
    vi.spyOn(fs, 'writeFile').mockImplementation(async (...args) => {
        await write(...args);
        if (typeof args[0] === 'string' && args[0].startsWith(transcriptPath()) && args[0].endsWith('.tmp')) await sessions.setActiveSession(null);
    });
    const save = kind === 'draft' ? sessions.saveSummaryDraft('speech', disk.summaryDraft!, new AbortController().signal, generation) :
        sessions.saveSummary('speech', { ...disk.summary!, brief: 'Late replacement.' }, new AbortController().signal, generation);
    await expect(save).rejects.toMatchObject({ name: 'AbortError' });
    expect(await fs.readFile(transcriptPath(), 'utf8')).toBe(original);
    expect((await fs.readdir(path.dirname(transcriptPath()))).filter((name) => name.endsWith('.tmp'))).toEqual([]);
});

it('does not reinterpret a legacy normalized cache as an exact-source brief retry', async () => {
    const sessions = await createSession('The delivery remains unconfirmed.');
    failBrief = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await controller(sessions).generate();
    const disk = await readDisk();
    const { progress: _progress, ...draft } = disk.summaryDraft!;
    disk.summary = { ...draft, brief: '' };
    delete disk.summaryDraft;
    disk.segments[0].id = 'changed-with-same-normalized-hash';
    await fs.writeFile(transcriptPath(), JSON.stringify(disk));
    const readable = (await new SessionsService().readSummaryInput('speech')).saved!;
    expect(readable.detailed).toBe(note);
    expect(readable).not.toHaveProperty('sourceRevision');
    expect(readable.reviewedChunks![0]).not.toHaveProperty('sourceRefs');
    drafts = []; failBrief = false;
    await expect(controller(new SessionsService()).generate()).resolves.toMatchObject({ ok: true });
    expect(drafts).toHaveLength(1);
    expect((await readDisk()).summary!.reviewedChunks![0].sourceRefs![0].segmentId).toBe('changed-with-same-normalized-hash');
});

it.each(['text', 'whitespace', 'id', 'speaker'])('rejects stale draft and completion saves after a %s edit', async (edit) => {
    const sessions = await createSession('The delivery remains unconfirmed.', true);
    failBrief = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await controller(sessions).generate();
    const original = await readDisk();
    const changed = structuredClone(original);
    if (edit === 'text') changed.segments[0].text = 'A different discussion.';
    if (edit === 'whitespace') changed.segments[0].text = 'The  delivery remains unconfirmed.';
    if (edit === 'id') changed.segments[0].id = 'other';
    if (edit === 'speaker') changed.speakers!.speakers[0].name = 'Other';
    await sessions.saveTranscript('speech', changed);
    const updated = await sessions.readSummaryInput('speech');
    if (edit === 'whitespace' || edit === 'id') expect(updated.inputHash).toBe(original.summaryDraft!.inputHash);
    expect(updated.sourceRevision).not.toBe(original.summaryDraft!.sourceRevision);
    const bytes = await fs.readFile(transcriptPath(), 'utf8');
    await expect(sessions.saveSummaryDraft('speech', original.summaryDraft!, new AbortController().signal)).rejects.toThrow('The transcript changed');
    await expect(sessions.saveSummary('speech', { ...original.summaryDraft!, brief: 'Late completion.' }, new AbortController().signal))
        .rejects.toThrow('The transcript changed');
    expect(await fs.readFile(transcriptPath(), 'utf8')).toBe(bytes);
});
