import { createHash } from 'crypto';
import fs from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import type { BrowserWindow, IpcMain } from 'electron';
import { expect, it, vi } from 'vitest';
import { registerSummaryModelController } from '../../../electron/src/controllers/summaryModelController';
import { SUMMARY_MODEL_FILE } from '../../../electron/src/services/summaryModel';
import { AppStore } from './appStore';
import { createPreloadAdapter } from './rendererAdapter';
import { createFakeRendererAdapter } from './testing/fakeRendererAdapter';

const bridge = vi.hoisted(() => ({
    directory: '',
    api: undefined as Window['api'] | undefined,
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    listeners: new Map<string, (event: unknown, payload: unknown) => void>(),
    fetch: vi.fn<typeof globalThis.fetch>(),
    weights: 'a'.repeat(200),
}));

vi.mock('electron', () => ({
    app: { getPath: () => bridge.directory },
    net: { fetch: bridge.fetch },
    contextBridge: { exposeInMainWorld: (_name: string, api: Window['api']) => { bridge.api = api; } },
    ipcRenderer: {
        invoke: (channel: string, ...args: unknown[]) => Promise.resolve().then(() => bridge.handlers.get(channel)!(undefined, ...args)),
        on: (channel: string, listener: (event: unknown, payload: unknown) => void) => bridge.listeners.set(channel, listener),
        removeListener: (channel: string) => bridge.listeners.delete(channel),
    },
}));

vi.mock('../../../electron/src/types/summaryModel', async (load) => {
    const actual = await load<typeof import('../../../electron/src/types/summaryModel')>();
    return { ...actual, SUMMARY_MODEL_ARTIFACT: {
        ...actual.SUMMARY_MODEL_ARTIFACT,
        bytes: bridge.weights.length,
        sha256: createHash('sha256').update(bridge.weights).digest('hex'),
    } };
});

it('waits for remote cancellation and cleanup, then retries across sessions without generating', async () => {
    bridge.directory = await fs.mkdtemp(path.join(tmpdir(), 'finelistener-model-ipc-'));
    const directory = path.join(bridge.directory, 'summary-models');
    const { promise: closeStream, resolve: finishStream } = Promise.withResolvers<void>();
    const { promise: oldReply, resolve: deliverOldReply } = Promise.withResolvers<void>();
    const cancelStream = vi.fn(() => closeStream);
    bridge.fetch.mockResolvedValueOnce(new Response(new ReadableStream({
        start: (stream) => {
            stream.enqueue(Buffer.from('aa'));
            stream.enqueue(Buffer.from('a'));
        },
        cancel: cancelStream,
    }))).mockResolvedValueOnce(new Response(bridge.weights));
    const ipc = { handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
        bridge.handlers.set(channel, handler);
    } } as unknown as IpcMain;
    const window = {
        isDestroyed: () => false,
        webContents: {
            isDestroyed: () => false,
            send: (channel: string, payload: unknown) => bridge.listeners.get(channel)?.(undefined, payload),
        },
    } as unknown as BrowserWindow;
    const service = registerSummaryModelController(ipc, () => window);
    const generate = vi.fn();
    bridge.handlers.set('sessions:generate-summary', generate);
    await import('../../../electron/preload.js');
    const adapter = createPreloadAdapter(bridge.api)!;
    const download = vi.fn(adapter.downloadSummaryModel).mockImplementationOnce(async () => {
        const result = await adapter.downloadSummaryModel();
        await oldReply;
        return result;
    });
    const { adapter: workspaceAdapter } = createFakeRendererAdapter({
        getSession: (id) => Promise.resolve({
            id, title: id, createdAt: 1, updatedAt: 1, sourceKind: 'imported', hasTranscript: true,
            audioMode: 'original', audioOriginalPath: 'source.wav', audioWavPath: 'source.wav',
            transcript: { version: 1, segments: [{ source: 'system', text: id, startSec: 0, endSec: 1 }] },
        }),
        getSummaryModelStatus: adapter.getSummaryModelStatus,
        downloadSummaryModel: download,
        cancelSummaryModelDownload: adapter.cancelSummaryModelDownload,
        onSummaryModelChanged: adapter.onSummaryModelChanged,
        generateSummary: adapter.generateSummary,
    });
    const app = new AppStore(workspaceAdapter);
    app.initialize();
    try {
        expect((await app.openSession('first')).ok).toBe(true);
        const transfer = app.summary.downloadModel();
        await vi.waitFor(async () => {
            expect(app.summary.modelStatus).toMatchObject({ state: 'downloading', downloadedBytes: 2 });
            expect((await fs.stat(path.join(directory, SUMMARY_MODEL_FILE + '.partial'))).size).toBe(3);
        });
        expect((await app.openSession('second')).ok).toBe(true);
        const cancellation = app.summary.cancelModelDownload();
        await vi.waitFor(() => expect(cancelStream).toHaveBeenCalledOnce());
        expect(app.summary.modelStatus?.state).toBe('downloading');
        finishStream();
        await cancellation;
        expect(await fs.readdir(directory)).toEqual([]);
        expect(app.summary.modelStatus).toMatchObject({ state: 'cancelled', downloadedBytes: 3 });
        expect(app.summary.modelError).toBeNull();

        await app.summary.downloadModel();
        expect(await fs.readFile(path.join(directory, SUMMARY_MODEL_FILE), 'utf8')).toBe(bridge.weights);
        deliverOldReply();
        await transfer;
        expect(app.summary.modelStatus?.state).toBe('ready');
        expect((await app.openSession('first')).ok).toBe(true);
        expect(app.canSummarize).toBe(true);
        expect(generate).not.toHaveBeenCalled();
    } finally {
        finishStream();
        deliverOldReply();
        app.dispose();
        await service.stopAndWait();
        await fs.rm(bridge.directory, { recursive: true, force: true });
    }
});
