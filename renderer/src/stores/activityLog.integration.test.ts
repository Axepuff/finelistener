import type { BrowserWindow, IpcMain } from 'electron';
import { expect, it, vi } from 'vitest';
import { AppStore } from './appStore';
import { createFakeRendererAdapter } from './testing/fakeRendererAdapter';
import { SpeakerAnalysisError } from '../../../electron/src/services/speakerProcess';
import { registerSpeakerController } from '../../../electron/src/controllers/speakerController';
import { registerSummaryController } from '../../../electron/src/controllers/summaryController';
import { generateLocalSummary } from '../../../electron/src/services/localSummary';
import type { SessionsService } from '../../../electron/src/services/SessionsService';
import type { SummaryGenerationResult } from '../../../electron/src/types/sessions';
import { defaultRecordingSummaryOptions } from '../../../electron/src/types/summaryOptions';

vi.mock('../../../electron/src/services/SpeakerDiarizationService', () => ({ SpeakerDiarizationService: class {} }));
vi.mock('../../../electron/src/services/localSummary', () => ({ generateLocalSummary: vi.fn(), SUMMARY_MODEL: 'Synthetic local model' }));

it.each([
    [new Error('C:\\private\\recording.wav is unavailable'), 'Speaker action failed.'],
    [new SpeakerAnalysisError('SPEAKER_GPU_UNAVAILABLE', { cause: new Error('C:\\private\\runtime: missing driver') }), 'SPEAKER_GPU_UNAVAILABLE'],
])('logs an internal speaker error and sends only its public code through IPC', async (internalError, publicMessage) => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = { handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
    } } as unknown as IpcMain;
    const sessions = {
        getActiveSessionId: () => null,
        getActiveSessionGeneration: () => 0,
        getSession: vi.fn().mockRejectedValue(internalError),
    } as unknown as SessionsService;
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fake = createFakeRendererAdapter();
    const store = new AppStore(fake.adapter);
    store.initialize();
    const view = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (channel: string, text: string) => {
        if (channel === 'transcribe:log') fake.emitTranscribeLog(text);
    } } } as unknown as BrowserWindow;
    const workflow = registerSpeakerController(ipc, () => view, sessions, () => false);

    try {
        await expect(handlers.get('sessions:analyze-speakers')!(undefined, 'session', {}))
            .rejects.toMatchObject({ message: publicMessage });
        expect(logged).toHaveBeenCalledWith('Speaker analysis failed', internalError);
        expect(store.activityLog.content).toContain('Speaker analysis failed');
        expect(store.activityLog.content).toContain('C:\\private\\');
        if (internalError instanceof SpeakerAnalysisError) expect(store.activityLog.content).toContain('missing driver');
        const stop = vi.spyOn(workflow, 'stopAndWait').mockRejectedValueOnce(new Error('Synthetic runtime stop acknowledgement lost'));
        await expect(handlers.get('sessions:stop-speaker-analysis')!()).rejects.toThrow('Speaker action failed.');
        expect(store.activityLog.content).toContain('Speaker stop failed: Error: Synthetic runtime stop acknowledgement lost');
        stop.mockRestore();
    } finally {
        store.dispose();
        logged.mockRestore();
    }
});

it.each([
    [new Error('SUMMARY_PROMPT_TOO_LONG'), 'prompt-too-long', 'SUMMARY_PROMPT_TOO_LONG'],
    [new Error('Runtime request failed', { cause: new Error('Synthetic HTTP 503 from local runtime') }), 'failed', 'Synthetic HTTP 503 from local runtime'],
])('keeps technical Summary details in the activity log while returning typed failure', async (error, reason, detail) => {
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    const ipc = { handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(channel, handler) } as unknown as IpcMain;
    const fake = createFakeRendererAdapter({ generateSummary: (id, options) => handlers.get('sessions:generate-summary')!(undefined, id, options) as Promise<SummaryGenerationResult> });
    const store = new AppStore(fake.adapter);
    const view = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (channel: string, payload: string) => {
        if (channel === 'transcribe:log') fake.emitTranscribeLog(payload);
    } } } as unknown as BrowserWindow;
    const sessions = { getActiveSessionGeneration: () => 0, readSummaryInput: () => Promise.resolve({ rows: [{ text: 'Synthetic speech', startSec: 0, endSec: 1 }], inputHash: 'hash' }) };
    vi.mocked(generateLocalSummary).mockRejectedValueOnce(error);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    registerSummaryController(ipc, () => view, sessions as unknown as SessionsService, () => false, () => Promise.resolve('synthetic-model.gguf'));
    store.initialize();
    try {
        await store.summary.generate('session', defaultRecordingSummaryOptions, () => { throw new Error('Failed generation must not save a result'); });
        expect(store.summary.generationFailure?.reason).toBe(reason);
        expect(store.activityLog.content).toContain('Summary generation failed');
        expect(store.activityLog.content).toContain('session session');
        expect(store.activityLog.content).toContain(detail);
        expect(store.summary.error).not.toContain('Synthetic HTTP 503');
        expect(store.operations.isBusy).toBe(false);
    } finally { store.dispose(); }
});
