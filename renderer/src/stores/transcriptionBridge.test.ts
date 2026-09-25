import type { BrowserWindow, IpcMain } from 'electron';
import type { TranscriptionCallbacks } from 'electron/src/services/whisperServer/types';
import type { TranscribeOpts } from 'electron/src/types/transcription';
import { expect, it, vi } from 'vitest';
import { registerTranscriptionController } from '../../../electron/src/controllers/transcriptionController';
import '../../../electron/preload';
import { AppStore } from './appStore';
import { createFakeRendererAdapter } from './testing/fakeRendererAdapter';

const bridge = vi.hoisted(() => ({
    expose: vi.fn(),
    invoke: vi.fn(),
    transcribe: vi.fn(),
    callbacks: null as TranscriptionCallbacks | null,
    listeners: new Map<string, (event: unknown, payload: unknown) => void>(),
}));

vi.mock('electron', () => ({
    contextBridge: { exposeInMainWorld: bridge.expose },
    ipcRenderer: {
        invoke: bridge.invoke,
        on: (channel: string, listener: (event: unknown, payload: unknown) => void) => {
            bridge.listeners.set(channel, listener);
        },
        removeListener: (channel: string) => { bridge.listeners.delete(channel); },
    },
}));
vi.mock('../../../electron/src/services/SessionsService', () => ({ SessionsService: class {} }));
vi.mock('../../../electron/src/services/TranscriptionService', () => ({
    TranscriptionService: class {
        constructor(callbacks: TranscriptionCallbacks) { bridge.callbacks = callbacks; }
        transcribe = bridge.transcribe;
    },
}));

it('delivers structured text and progress through the controller and preload to the store', async () => {
    const ipc = {
        handle: vi.fn<(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => void>(),
    };
    const window = {
        webContents: {
            send: (channel: string, payload: unknown) => bridge.listeners.get(channel)?.(undefined, payload),
        },
    };

    registerTranscriptionController(ipc as unknown as IpcMain, () => window as unknown as BrowserWindow);
    bridge.invoke.mockImplementation((channel: string, ...args: unknown[]) => {
        const handler = ipc.handle.mock.calls.find(([name]) => name === channel)?.[1];

        if (!handler) throw new Error(`Missing IPC handler: ${channel}`);

        return handler(undefined, ...args);
    });
    const api = bridge.expose.mock.calls[0][1] as NonNullable<Window['api']>;
    let finish: (text: string) => void = () => undefined;
    const text = '[00:00:00.000 --> 00:00:01.000] Real streaming text\n';

    bridge.transcribe.mockImplementation((_path: string, options: TranscribeOpts) => {
        bridge.callbacks?.onStdoutChunk?.({ runId: options.runId, chunk: text });
        bridge.callbacks?.onProgressPercent?.({ runId: options.runId, value: 42 });

        return new Promise<string>((resolve) => { finish = resolve; });
    });
    const fake = createFakeRendererAdapter({
        transcribe: api.transcribeStream,
        onTranscribeText: api.onTranscribeText,
        onTranscribeProgress: api.onTranscribeProgressValue,
    });
    const store = new AppStore(fake.adapter);

    store.workspace.replaceWorkspace({
        id: '', title: 'Audio', createdAt: 1, updatedAt: 1, sourceKind: 'imported',
        hasTranscript: false, audioOriginalPath: 'audio.wav', audioWavPath: 'audio.wav',
    });
    store.initialize();
    try {
        const run = store.startTranscription({ language: 'en', model: 'base', splitOnWord: true, useVad: true });

        expect(store.transcription.plainText).toBe('Real streaming text');
        expect(store.transcription.progress).toBe(42);
        bridge.listeners.get('transcribe:progress')?.(undefined, 'Legacy untagged text');
        expect(store.transcription.plainText).toBe('Real streaming text');
        finish(text);
        expect((await run).ok).toBe(true);
        expect(store.transcription.plainText).toBe('Real streaming text');
    } finally {
        store.dispose();
    }
    expect(bridge.listeners.size).toBe(0);
});
