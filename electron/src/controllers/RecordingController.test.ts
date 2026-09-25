import { tmpdir } from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { expect, it, vi } from 'vitest';
import type { IpcMain } from 'electron';
import { registerRecordingController } from './recordingController';
import { RecordingArchive } from '../services/RecordingArchive';

const bridge = vi.hoisted(() => ({
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    api: null as null | { startSystemRecording: () => Promise<unknown> },
}));

vi.mock('electron', () => ({
    app: { getPath: () => tmpdir(), getAppPath: () => tmpdir() },
    shell: {},
    contextBridge: { exposeInMainWorld: (_name: string, api: typeof bridge.api) => { bridge.api = api; } },
    ipcRenderer: {
        invoke: async (channel: string, ...args: unknown[]) => {
            try {
                return await bridge.handlers.get(channel)!(undefined, ...args);
            } catch (error) {
                throw new Error(`Error invoking remote method '${channel}': ${String(error)}`);
            }
        },
    },
}));
vi.mock('../services/capture/MiniAudioAdapter', () => ({
    MiniAudioAdapter: class { isAvailable = () => true; },
    MINIAUDIO_WAV_FORMAT: { sampleRateHz: 16000, channels: 1, bitDepth: 16, codec: 'pcm_s16le' },
}));
vi.mock('../services/capture/AudioteeAdapter', () => ({
    AudioteeAdapter: class { isAvailable = () => true; },
}));

it('returns a storage-full code through controller and preload without an IPC error wrapper', async () => {
    const archive = new RecordingArchive({
        rootDir: path.join(tmpdir(), randomUUID()), recoveryQuotaBytes: 0,
    });
    const ipc = { handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
        bridge.handlers.set(channel, handler);
    } } as unknown as IpcMain;
    registerRecordingController(ipc, () => null, archive);
    await import('../../preload.js');

    await expect(bridge.api!.startSystemRecording()).resolves.toEqual({ error: 'recording-storage-full' });
});
