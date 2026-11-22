import { createHash } from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { BrowserWindow, IpcMain } from 'electron';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { registerSessionsController } from '../../../electron/src/controllers/sessionsController';
import { registerSummaryController } from '../../../electron/src/controllers/summaryController';
import { registerSummaryModelController } from '../../../electron/src/controllers/summaryModelController';
import { generateLocalSummary, SUMMARY_MODEL } from '../../../electron/src/services/localSummary';
import { generateRecordingNotes } from '../../../electron/src/services/recordingNotes';
import { SessionsService } from '../../../electron/src/services/SessionsService';
import type { SessionTranscriptV1, SummaryProgressEvent } from 'electron/src/types/sessions';
import { defaultRecordingSummaryOptions } from '../../../electron/src/types/summaryOptions';
import { SUMMARY_MODEL_ARTIFACT } from '../../../electron/src/types/summaryModel';
import { AppStore } from './appStore';
import { createPreloadAdapter } from './rendererAdapter';
import { createFakeRendererAdapter } from './testing/fakeRendererAdapter';

const bridge = vi.hoisted(() => ({ root: '', api: undefined as Window['api'] | undefined,
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    listeners: new Map<string, (event: unknown, payload: unknown) => void>(), fetch: vi.fn<typeof globalThis.fetch>(),
    pending: new Set<Promise<unknown>>(),
}));
vi.mock('electron', () => ({ app: { getPath: () => bridge.root }, shell: {}, dialog: {}, net: { fetch: bridge.fetch },
    contextBridge: { exposeInMainWorld: (_name: string, api: Window['api']) => { bridge.api = api; } },
    ipcRenderer: {
        invoke: (channel: string, ...args: unknown[]) => {
            const result = Promise.resolve().then(() => bridge.handlers.get(channel)!(undefined, ...args));
            bridge.pending.add(result);
            void result.then(() => bridge.pending.delete(result), () => bridge.pending.delete(result));
            return result;
        },
        on: (channel: string, listener: (event: unknown, payload: unknown) => void) => bridge.listeners.set(channel, listener),
        removeListener: (channel: string) => bridge.listeners.delete(channel),
    },
}));
vi.mock('../../../electron/src/types/summaryModel', async (load) => {
    const actual = await load<typeof import('../../../electron/src/types/summaryModel')>();
    return { ...actual, SUMMARY_MODEL_ARTIFACT: { ...actual.SUMMARY_MODEL_ARTIFACT, bytes: 3,
        sha256: createHash('sha256').update('abc').digest('hex') } };
});
// Only native inference and Electron transport are controlled; stores, controllers and disk are real.
vi.mock('../../../electron/src/services/localSummary', () => ({ generateLocalSummary: vi.fn(), SUMMARY_MODEL: 'Qwen3-4B-Instruct-2507 Q4_K_M' }));

const options = { ...defaultRecordingSummaryOptions, prompt: 'Keep the agreed delivery details.', chunkCount: 4, overlapPercent: 17 };
const note = 'The speakers discussed delivery and agreed to confirm the date on Friday.';
let inputs: string[];
let failBrief: boolean;
let stopAt: number;
let current: AppStore;
let sessions: SessionsService;
const apps: AppStore[] = [];
const shutdowns: Array<() => Promise<unknown>> = [];
const transcriptPath = () => path.join(bridge.root, 'sessions/speech/transcript/transcript.v1.json');
const readDisk = async () => JSON.parse(await fs.readFile(transcriptPath(), 'utf8')) as SessionTranscriptV1;
const drain = async () => { while (bridge.pending.size) await Promise.all(bridge.pending); };

const openRuntime = async () => {
    await drain();
    bridge.handlers.clear();
    sessions = new SessionsService();
    const ipc = { handle: (channel: string, handler: (...args: unknown[]) => unknown) => bridge.handlers.set(channel, handler) } as unknown as IpcMain;
    const window = { isDestroyed: () => false, webContents: { isDestroyed: () => false,
        send: (channel: string, payload: SummaryProgressEvent) => {
            bridge.listeners.get(channel)?.(undefined, payload);
            if (channel === 'sessions:summary-progress' && stopAt && payload.draft?.reviewedChunks.length === stopAt) {
                stopAt = 0;
                void current.summary.stop();
            }
        },
    } } as unknown as BrowserWindow;
    registerSessionsController(ipc, () => window, sessions);
    const model = registerSummaryModelController(ipc, () => window);
    const generation = registerSummaryController(ipc, () => window, sessions, () => false, (signal) => model.requireInstalled(signal));
    shutdowns.push(() => generation.stopAndWait(), () => model.stopAndWait());
    await import('../../../electron/preload.js');
    const api = createPreloadAdapter(bridge.api)!;
    const { adapter } = createFakeRendererAdapter({
        listSessions: api.listSessions, getSession: api.getSession, setActiveSession: api.setActiveSession,
        getSummaryModelStatus: api.getSummaryModelStatus, downloadSummaryModel: api.downloadSummaryModel,
        cancelSummaryModelDownload: api.cancelSummaryModelDownload, onSummaryModelChanged: api.onSummaryModelChanged,
        generateSummary: api.generateSummary, stopSummary: api.stopSummary, onSummaryProgress: api.onSummaryProgress,
    });
    current = new AppStore(adapter);
    apps.push(current);
    current.initialize();
    expect((await current.openSession('speech')).ok).toBe(true);
    await current.summary.refreshModelStatus();
    return current;
};

beforeEach(async () => {
    bridge.root = await fs.mkdtemp(path.join(os.tmpdir(), 'finelistener-summary-wiring-'));
    inputs = []; failBrief = false; stopAt = 0;
    bridge.fetch.mockReset().mockResolvedValue(new Response('abc'));
    vi.mocked(generateLocalSummary).mockReset().mockImplementation((rows, _model, signal, progress, onReviewed, cached, hint, requested, resume) =>
        generateRecordingNotes(rows, {
            countTokens: (text) => { signal.throwIfAborted(); return Promise.resolve(Array.from(text).length); },
            complete: (prompt) => {
                signal.throwIfAborted();
                const body = prompt.split('<|im_start|>user\n')[1].split('\n<|im_end|>')[0];
                if (body.includes('NEW LINES\n')) inputs.push(body);
                return Promise.resolve(failBrief && !body.includes('NEW LINES\n') && !body.includes('ORIGINAL LINES\n') ? null : note);
            },
        }, progress, onReviewed, cached, hint, requested, resume));
    const dir = path.join(bridge.root, 'sessions/speech');
    await fs.mkdir(dir, { recursive: true });
    const wav = Buffer.alloc(364);
    wav.write('RIFF'); wav.writeUInt32LE(356, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24);
    wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(320, 40);
    await fs.writeFile(path.join(dir, 'source.wav'), wav);
    await fs.writeFile(path.join(dir, 'session.json'), JSON.stringify({ version: 1, id: 'speech', audioMode: 'original',
        audio: { originalPath: 'source.wav', wavPath: 'source.wav', originalFileName: 'source.wav' } }));
    sessions = new SessionsService();
    await sessions.saveTranscript('speech', { version: 1, recognitionRevision: 'r', segments: [{ id: 'source', startSec: 0, endSec: 90,
        text: Array.from({ length: 150 }, (_, i) => `We discussed delivery item ${i} and its date. `).join('') }] });
    const input = await sessions.readSummaryInput('speech');
    await sessions.saveSummary('speech', { brief: 'Previous overview.', detailed: 'Previous notes.', inputHash: input.inputHash, model: SUMMARY_MODEL }, new AbortController().signal);
});
afterEach(async () => {
    for (const app of apps.splice(0)) app.dispose();
    for (const shutdown of shutdowns.splice(0)) await shutdown();
    await drain();
    bridge.listeners.clear();
    await fs.rm(bridge.root, { recursive: true, force: true });
});

const stopAndReopen = async () => {
    const app = await openRuntime();
    await app.summary.downloadModel();
    stopAt = 2;
    await app.generateSummary(options);
    expect(app.summary.stopped).toBe(true);
    app.dispose();
    return openRuntime();
};

it('wires explicit install, stop/reopen/Continue and brief retry to real session persistence with complete options', async () => {
    const first = await openRuntime();
    expect(first.summary.modelStatus?.state).toBe('missing');
    expect(bridge.fetch).not.toHaveBeenCalled();
    await first.summary.downloadModel();
    expect(first.summary.modelStatus?.state).toBe('ready');
    expect(generateLocalSummary).not.toHaveBeenCalled();
    stopAt = 2;
    await first.generateSummary(options);
    const checkpoint = (await readDisk()).summaryDraft!;
    expect(first.transcription.savedTranscript?.summary?.brief).toBe('Previous overview.');
    expect(checkpoint.options).toEqual(options);
    first.dispose();
    bridge.fetch.mockRejectedValue(new Error('Offline'));
    const reopened = await openRuntime();
    expect(reopened.summary.stopped).toBe(false);
    const continuation = reopened.summaryContinuation!;
    expect(continuation.options).toEqual(options);
    continuation.onContinue();
    continuation.onContinue();
    await vi.waitFor(() => expect(reopened.summary.isRunning).toBe(false));
    expect(generateLocalSummary).toHaveBeenCalledTimes(2);
    expect(vi.mocked(generateLocalSummary).mock.calls[1][8]).toEqual(checkpoint.progress);
    expect(new Set(inputs).size).toBe(inputs.length);
    expect((await readDisk()).summaryDraft).toBeUndefined();
    const completed = (await readDisk()).summary!;
    expect(completed.options).toEqual(options);
    expect(completed.detailed).toBe(completed.reviewedChunks!.map((chunk) => chunk.text).join('\n\n'));
    expect(reopened.summaryContinuation).toBeUndefined();

    failBrief = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await reopened.generateSummary({ ...options, prompt: 'Describe the discussion.' });
    expect(reopened.transcription.savedTranscript?.summary).toEqual(completed);
    expect((await readDisk()).summaryDraft?.progress.phase).toBe('brief');
    const acceptedInputs = inputs.length;
    failBrief = false;
    reopened.summaryContinuation!.onContinue();
    await vi.waitFor(() => expect(reopened.summary.isRunning).toBe(false));
    expect(inputs).toHaveLength(acceptedInputs);
    expect((await readDisk()).summaryDraft).toBeUndefined();

    await fs.rm(path.join(bridge.root, 'summary-models', SUMMARY_MODEL_ARTIFACT.fileName));
    reopened.dispose();
    const offline = await openRuntime();
    expect(offline.summary.modelStatus?.state).toBe('missing');
    expect(offline.transcription.savedTranscript?.summary?.detailed).toBe(completed.detailed);
    expect(bridge.fetch).toHaveBeenCalledOnce();
});

it.each(['session', 'transcript', 'options', 'operation', 'busy', 'model', 'dispose'])(
    'rejects a captured Continue callback after %s changes', async (change) => {
        const app = await stopAndReopen();
        const continuation = app.summaryContinuation!;
        const calls = vi.mocked(generateLocalSummary).mock.calls.length;
        if (change === 'session') app.workspace.replaceWorkspace({ ...app.workspace.activeSession!, id: 'other', hasTranscript: true });
        if (change === 'transcript') app.transcription.replaceSavedTranscript({ ...app.transcription.savedTranscript!, segments: [] });
        if (change === 'options') app.transcription.setSummaryDraft({ ...(await readDisk()).summaryDraft!, options: { ...options, prompt: 'A new request.' } });
        if (change === 'operation' || change === 'busy') {
            const operation = app.operations.begin('editing-speakers')!;
            if (change === 'operation') app.operations.finish(operation);
        }
        if (change === 'model') {
            await fs.rm(path.join(bridge.root, 'summary-models', SUMMARY_MODEL_ARTIFACT.fileName));
            await app.summary.refreshModelStatus();
        }
        if (change === 'dispose') app.dispose();
        continuation.onContinue();
        expect(app.summary.isRunning).toBe(false);
        await Promise.resolve();
        expect(generateLocalSummary).toHaveBeenCalledTimes(calls);
        expect((await readDisk()).summaryDraft?.options).toEqual(options);
    },
);

it.each(['model', 'source', 'cursor'])('does not offer Continue for incompatible persisted %s', async (change) => {
    const app = await stopAndReopen();
    app.dispose();
    const transcript = await readDisk();
    if (change === 'model') transcript.summaryDraft!.model = 'Different model';
    if (change === 'source') transcript.segments[0].text += ' A correction.';
    if (change === 'cursor') transcript.summaryDraft!.progress.cursors[0].endChar++;
    await fs.writeFile(transcriptPath(), JSON.stringify(transcript));
    const reopened = await openRuntime();
    expect(reopened.summaryContinuation).toBeUndefined();
});
