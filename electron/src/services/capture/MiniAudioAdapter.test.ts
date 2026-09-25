import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MiniAudioAdapter, MINIAUDIO_WAV_FORMAT } from './MiniAudioAdapter';
import type { CaptureAdapterEvents, RecordingSources } from './CaptureAdapter';
import type { RecordingResult } from '../RecordingService';

const mocks = vi.hoisted(() => ({
    spawn: vi.fn(),
    rm: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('child_process', () => ({ spawn: mocks.spawn }));
vi.mock('fs/promises', () => ({ default: { access: vi.fn().mockResolvedValue(undefined), mkdir: vi.fn().mockResolvedValue(undefined), rm: mocks.rm } }));
vi.mock('electron', () => ({ app: {} }));

class Helper extends EventEmitter {
    public stdin = new PassThrough();
    public stdout = new PassThrough();
    public stderr = new PassThrough();
    public kill = vi.fn(() => true);

    public message(value: object): void {
        this.stdout.write(`${JSON.stringify(value)}\n`);
    }

    public finish(): void {
        this.message({ type: 'finished', durationMs: 1234 });
        this.emit('close', 0, null);
    }
}

describe('MiniAudioAdapter coordinated helper lifecycle', () => {
    const originalPlatform = process.platform;
    let helper: Helper;
    let adapter: MiniAudioAdapter;

    beforeEach(() => {
        vi.clearAllMocks();
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        helper = new Helper();
        mocks.spawn.mockReturnValue(helper);
        adapter = new MiniAudioAdapter({ binaryPath: 'capture-helper.exe' });
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
        vi.restoreAllMocks();
    });

    const start = async (current: MiniAudioAdapter, sources: RecordingSources, events: CaptureAdapterEvents = {}) => {
        const pending = current.startRecording({ outputPath: 'C:/recordings/take.wav', format: MINIAUDIO_WAV_FORMAT, sources }, events);

        await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());

        return { pending };
    };

    it('waits for every device to be ready, then closes WAVs through stdin on manual stop', async () => {
        const onFinished = vi.fn();
        const { pending } = await start(adapter, { system: 'speaker', microphone: 'mic' }, { onFinished });
        let ready = false;

        void pending.then(() => { ready = true; });
        await Promise.resolve();
        expect(ready).toBe(false);
        expect(helper.stdin.writableEnded).toBe(false);
        helper.message({ type: 'ready' });
        await pending;
        const stop = adapter.stopRecording();

        const command: unknown = helper.stdin.read();

        expect(Buffer.isBuffer(command) ? command.toString() : command).toBe('stop\n');
        expect(helper.kill).not.toHaveBeenCalled();
        helper.finish();
        const result = await stop;

        expect(result.tracks?.map(({ source, startOffsetMs }) => ({ source, startOffsetMs }))).toEqual([
            { source: 'system', startOffsetMs: 0 }, { source: 'microphone', startOffsetMs: 0 },
        ]);
        expect(result.durationMs).toBe(1234);
        expect(onFinished).not.toHaveBeenCalled();
        expect(await adapter.stopRecording()).toEqual(result);
    });

    it('rejects a failed transactional startup and removes its provisional files', async () => {
        const onError = vi.fn();
        const { pending } = await start(adapter, { system: '', microphone: 'missing' }, { onError });
        const rejected = expect(pending).rejects.toThrow('Missing microphone');

        helper.message({ type: 'error', message: 'Missing microphone' });
        helper.emit('close', 1, null);
        await rejected;
        expect(mocks.rm).toHaveBeenCalledTimes(2);
        expect(onError).not.toHaveBeenCalled();
    });

    it('keeps surviving audio active and returns source failures on automatic finish', async () => {
        const onProgress = vi.fn();
        const onError = vi.fn();
        const onFinished = vi.fn<(result: RecordingResult) => void>();
        const { pending } = await start(adapter, { system: '', microphone: '' }, { onProgress, onError, onFinished });

        helper.message({ type: 'ready' });
        await pending;
        helper.message({ type: 'source-error', source: 'microphone', message: 'Unavailable' });
        expect(helper.stdin.writableEnded).toBe(false);
        expect(helper.kill).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
        expect(onProgress).toHaveBeenCalledWith({ durationMs: 0, sourceFailures: [{ source: 'microphone', message: 'Unavailable' }] });
        helper.message({ type: 'source-error', source: 'system', message: 'Unavailable' });
        helper.finish();
        expect(onFinished).toHaveBeenCalledOnce();
        expect(onFinished.mock.calls[0][0].tracks).toEqual([
            expect.objectContaining({ source: 'system', failure: 'Unavailable' }),
            expect.objectContaining({ source: 'microphone', failure: 'Unavailable' }),
        ]);
    });

    it('returns finalized tracks when the helper reports a recoverable finalization failure', async () => {
        const onError = vi.fn();
        const onFinished = vi.fn<(result: RecordingResult) => void>();
        const { pending } = await start(adapter, { system: '', microphone: '' }, { onError, onFinished });

        helper.message({ type: 'ready' });
        await pending;
        helper.message({ type: 'progress', durationMs: 900 });
        helper.message({ type: 'error', message: 'Could not finalize recording audio.', recoverable: true });
        helper.emit('close', 1, null);

        await vi.waitFor(() => expect(onFinished).toHaveBeenCalledOnce());
        expect(onError).not.toHaveBeenCalled();
        expect(onFinished.mock.calls[0][0]).toMatchObject({
            durationMs: 900,
            tracks: [
                { source: 'system', filePath: 'C:/recordings/take.wav', startOffsetMs: 0 },
                expect.objectContaining({ source: 'microphone', startOffsetMs: 0 }),
            ],
        });
        expect(onFinished.mock.calls[0][0].sourceFailures).toEqual([
            { source: 'system', message: 'Recording source may be incomplete.' },
            { source: 'microphone', message: 'Recording source may be incomplete.' },
        ]);
        await expect(adapter.stopRecording()).resolves.toEqual(onFinished.mock.calls[0][0]);
    });

    it('uses the primary path for microphone-only capture and rejects forced termination', async () => {
        const { pending } = await start(adapter, { system: null, microphone: '' });

        expect(mocks.spawn.mock.calls[0][1]).toEqual(expect.arrayContaining(['--system-off', '--microphone-output', 'C:/recordings/take.wav']));
        helper.message({ type: 'ready' });
        await pending;
        const stop = adapter.stopRecording();
        const rejected = expect(stop).rejects.toThrow('before finalizing');

        helper.emit('close', null, 'SIGTERM');
        await rejected;
    });
});
