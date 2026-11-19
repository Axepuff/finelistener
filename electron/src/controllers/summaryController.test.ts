import type { BrowserWindow, IpcMain } from 'electron';
import { expect, it, vi } from 'vitest';
import { generateLocalSummary, SUMMARY_MODEL } from '../services/localSummary';
import type { SessionsService } from '../services/SessionsService';
import type { SessionSummary } from '../types/sessions';
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

it('keeps reviewed notes after a failed brief and reuses them on retry', async () => {
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const ipc = { handle: (name: string, fn: (...args: unknown[]) => Promise<unknown>) => handlers.set(name, fn) } as unknown as IpcMain;
    let saved: SessionSummary | undefined;
    const chunks = [{ text: 'A decision.', startSec: 10, endSec: 12 }];
    const sessions = {
        readSummaryInput: () => Promise.resolve({ rows: chunks, inputHash: 'same revision', saved }),
        saveSummary: (_id: string, item: SessionSummary) => { saved = item; return Promise.resolve(item); },
    };
    registerSummaryController(ipc, () => null, sessions as unknown as SessionsService, () => false,
        () => Promise.resolve('local.gguf'));
    const generate = handlers.get('sessions:generate-summary')!;
    vi.mocked(generateLocalSummary).mockImplementationOnce(async (_rows, _model, _signal, _progress, onReviewed) => {
        await onReviewed(chunks);
        throw new Error('Brief generation interrupted');
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
        await expect(generate(undefined, 'session')).resolves.toEqual({ ok: false, reason: 'failed' });
    } finally {
        log.mockRestore();
    }
    expect(saved).toMatchObject({ brief: '', detailed: 'A decision.', reviewedChunks: chunks });
    vi.mocked(generateLocalSummary).mockImplementationOnce((_r, _m, _s, _p, _onReviewed, cached) => {
        expect(cached).toEqual(chunks);
        return Promise.resolve({ brief: 'Decision', detailed: 'A decision.' });
    });
    await expect(generate(undefined, 'session')).resolves.toMatchObject({ ok: true, summary: { brief: 'Decision', reviewedChunks: chunks } });
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
        saved: { brief: '', detailed: 'Decision', reviewedChunks: [chunk], inputHash: 'hash', model: SUMMARY_MODEL },
    }]);
});
