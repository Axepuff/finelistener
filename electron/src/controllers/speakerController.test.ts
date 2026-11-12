import type { IpcMain } from 'electron';
import { expect, it, vi } from 'vitest';
import type { SessionsService } from '../services/SessionsService';
import { SpeakerAnalysisError } from '../services/speakerProcess';
import { registerSpeakerController } from './speakerController';

vi.mock('../services/SpeakerDiarizationService', () => ({
    SpeakerDiarizationService: class {},
}));

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
    registerSpeakerController(ipc, () => null, sessions, () => false);

    try {
        await expect(handlers.get('sessions:analyze-speakers')!(undefined, 'session', {}))
            .rejects.toMatchObject({ message: publicMessage });
        expect(logged).toHaveBeenCalledWith('Speaker analysis failed', internalError);
    } finally {
        logged.mockRestore();
    }
});

it('accepts null speaker identities for merging while rejecting malformed IPC identities', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = { handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
    } } as unknown as IpcMain;
    const workflow = registerSpeakerController(ipc, () => null, {} as SessionsService, () => false);
    const merge = vi.spyOn(workflow, 'merge').mockResolvedValue({} as Awaited<ReturnType<typeof workflow.merge>>);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const handle = handlers.get('sessions:merge-speakers')!;
    try {
        await handle(undefined, 'session', null, 'alice');
        await handle(undefined, 'session', 'alice', null);
        expect(merge.mock.calls).toEqual([['session', null, 'alice'], ['session', 'alice', null]]);
        for (const invalid of [undefined, '', 5, {}]) {
            await expect(handle(undefined, 'session', invalid, 'alice')).rejects.toThrow('Speaker action failed.');
            await expect(handle(undefined, 'session', 'alice', invalid)).rejects.toThrow('Speaker action failed.');
        }
        expect(merge).toHaveBeenCalledTimes(2);
    } finally {
        logged.mockRestore();
        merge.mockRestore();
    }
});
