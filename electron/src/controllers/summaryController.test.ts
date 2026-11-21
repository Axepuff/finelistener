import type { BrowserWindow, IpcMain } from 'electron';
import { expect, it, vi } from 'vitest';
import { generateLocalSummary, SUMMARY_MODEL } from '../services/localSummary';
import type { SessionsService } from '../services/SessionsService';
import type { SessionSummary } from '../types/sessions';
import { defaultRecordingSummaryOptions, recordingSummaryGenerationVersion } from '../types/summaryOptions';
import { registerSummaryController } from './summaryController';

vi.mock('../services/localSummary', () => ({
    generateLocalSummary: vi.fn(), SUMMARY_MODEL: 'Local model',
}));

it('reports cancellation only when the summary did not commit and drains the active request', async () => {
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const ipc = { handle: (name: string, fn: (...args: unknown[]) => Promise<unknown>) => handlers.set(name, fn) } as unknown as IpcMain;
    const saved = { brief: 'Brief', detailed: 'Detailed', model: SUMMARY_MODEL, inputHash: 'hash' };
    let commit!: () => void;
    const sessions = {
        readSummaryInput: () => Promise.resolve({ rows: [{ text: 'Speech', startSec: 0, endSec: 1 }], inputHash: 'hash' }),
        saveSummary: vi.fn(() => new Promise<SessionSummary>((resolve) => { commit = () => resolve(saved); })),
    };
    const workflow = registerSummaryController(ipc, () => null, sessions as unknown as SessionsService, () => false,
        () => Promise.resolve('verified-model.gguf'));
    const generate = handlers.get('sessions:generate-summary')!;
    const stop = handlers.get('sessions:stop-summary')!;
    await expect(generate(undefined, 'session', { ...defaultRecordingSummaryOptions, prompt: ' ' }))
        .resolves.toEqual({ ok: false, reason: 'failed' });
    expect(workflow.isBusy).toBe(false);
    expect(generateLocalSummary).not.toHaveBeenCalled();
    vi.mocked(generateLocalSummary).mockImplementationOnce((_rows, _path, signal) => new Promise((_resolve, reject) => {
        signal.throwIfAborted();
        signal.addEventListener('abort', () => reject(new Error('Generation interrupted')), { once: true });
    }));

    const cancelled = generate(undefined, 'session');
    const cancellation = expect(cancelled).resolves.toEqual({ ok: false, reason: 'cancelled' });
    await expect(generate(undefined, 'session')).resolves.toEqual({ ok: false, reason: 'busy' });
    await expect(stop()).resolves.toBe(true);
    await cancellation;
    expect(sessions.saveSummary).not.toHaveBeenCalled();
    expect(workflow.isBusy).toBe(false);

    vi.mocked(generateLocalSummary).mockResolvedValueOnce(saved);
    const finishing = generate(undefined, 'session');
    await vi.waitFor(() => expect(sessions.saveSummary).toHaveBeenCalledOnce());
    const lateStop = stop();
    expect(workflow.isBusy).toBe(true);
    commit();
    await expect(finishing).resolves.toEqual({ ok: true, summary: saved });
    await expect(lateStop).resolves.toBe(false);
    expect(workflow.isBusy).toBe(false);
});

it('resumes interrupted notes only for matching settings and preserves a completed result during regeneration', async () => {
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const ipc = { handle: (name: string, fn: (...args: unknown[]) => Promise<unknown>) => handlers.set(name, fn) } as unknown as IpcMain;
    let saved: SessionSummary | undefined = {
        inputHash: 'same revision', model: SUMMARY_MODEL, brief: '', detailed: 'Old English notes.',
        reviewedChunks: [{ text: 'Old English notes.', startSec: 10, endSec: 12 }],
    };
    const row = { text: 'Saved speech.', startSec: 10, endSec: 12 };
    const sessions = {
        readSummaryInput: () => Promise.resolve({ rows: [row], inputHash: 'same revision', saved }),
        saveSummary: (_id: string, item: SessionSummary) => { saved = item; return Promise.resolve(item); },
    };
    registerSummaryController(ipc, () => null, sessions as unknown as SessionsService, () => false,
        () => Promise.resolve('local.gguf'));
    const generate = handlers.get('sessions:generate-summary')!;
    let pass = 0;
    let finishBrief = false;
    vi.mocked(generateLocalSummary).mockImplementation(async (_rows, _model, _signal, _progress, onReviewed, cached, _hint, options) => {
        const chunks = cached ?? [{ ...row, text: `${options?.prompt} (run ${++pass})` }];
        if (!cached) await onReviewed(chunks);
        if (!finishBrief) throw new Error('Brief generation interrupted');
        return { brief: 'Brief', detailed: chunks[0].text };
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
        const options = { prompt: 'Describe the subject.', chunkCount: 2, overlapPercent: 10 };
        const changedPrompt = { ...options, prompt: 'Summarize in a sentence.' };
        const changedCount = { ...changedPrompt, chunkCount: 3 };
        const changedOverlap = { ...changedCount, overlapPercent: 20 };
        for (const [index, request] of [options, changedPrompt, changedCount, changedOverlap].entries()) {
            await expect(generate(undefined, 'session', request)).resolves.toEqual({ ok: false, reason: 'failed' });
            expect(saved).toMatchObject({ brief: '', detailed: `${request.prompt} (run ${index + 1})`, options: request });
        }
        finishBrief = true;
        const text = 'Summarize in a sentence. (run 4)';
        await expect(generate(undefined, 'session', changedOverlap)).resolves.toMatchObject({
            ok: true, summary: { brief: 'Brief', detailed: text, options: changedOverlap, reviewedChunks: [{ ...row, text }] },
        });
        const completed = saved;
        finishBrief = false;
        await expect(generate(undefined, 'session', options)).resolves.toEqual({ ok: false, reason: 'failed' });
        expect(saved).toBe(completed);
    } finally {
        log.mockRestore();
        vi.mocked(generateLocalSummary).mockReset();
    }
});

it('publishes committed detailed notes when Stop arrives during their atomic save', async () => {
    const handle = vi.fn();
    const send = vi.fn();
    const chunk = { startSec: 1, endSec: 4, text: 'Decision' };
    let commit!: () => void;
    const sessions = {
        readSummaryInput: () => Promise.resolve({ rows: [chunk], inputHash: 'hash' }),
        saveSummary: vi.fn((_id: string, item: SessionSummary) => new Promise<SessionSummary>((resolve) => {
            commit = () => resolve(item);
        })),
    };
    const view = { isDestroyed: () => false, webContents: { send } } as unknown as BrowserWindow;
    const workflow = registerSummaryController({ handle } as unknown as IpcMain, () => view,
        sessions as unknown as SessionsService, () => false, () => Promise.resolve('model.gguf'));
    vi.mocked(generateLocalSummary).mockImplementationOnce(async (_rows, _model, signal, _progress, onReviewed) => {
        await onReviewed([chunk]);
        signal.throwIfAborted();
        throw new Error('Expected pending cancellation');
    });
    const generate = handle.mock.calls.find(([channel]) => channel === 'sessions:generate-summary')![1] as
        (event: unknown, id: string) => Promise<unknown>;
    const result = generate(undefined, 'session');
    await vi.waitFor(() => expect(sessions.saveSummary).toHaveBeenCalledOnce());
    const stopping = workflow.stopAndWait();
    commit();
    await expect(stopping).resolves.toBe(true);
    await expect(result).resolves.toEqual({ ok: false, reason: 'cancelled' });
    expect(send.mock.calls).toContainEqual(['sessions:summary-progress', {
        sessionId: 'session', message: 'Writing the brief summary…',
        saved: { brief: '', detailed: 'Decision', reviewedChunks: [chunk], inputHash: 'hash', model: SUMMARY_MODEL,
            generationVersion: recordingSummaryGenerationVersion, options: defaultRecordingSummaryOptions },
    }]);
});
