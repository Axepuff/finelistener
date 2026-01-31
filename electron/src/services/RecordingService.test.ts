import fs from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WAV_FORMAT } from './AudioPreprocessor';
import {
    RecordingService,
    type RecordingLevel,
    type RecordingProgress,
    type RecordingResult,
} from './RecordingService';
import type { CaptureAdapter, CaptureAdapterStartOptions, CaptureAdapterEvents } from './capture/CaptureAdapter';

let mockUserDataPath = '';

vi.mock('electron', () => ({
    app: {
        getPath: (name: string) => {
            if (name !== 'userData') {
                throw new Error(`Unsupported app path: ${name}`);
            }

            return mockUserDataPath;
        },
    },
}));

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: Error) => void;
};

const createDeferred = <T>(): Deferred<T> => {
    let resolve: (value: T) => void;
    let reject: (error: Error) => void;

    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return {
        promise,
        resolve: resolve!,
        reject: reject!,
    };
};

const flushPromises = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
        setImmediate(resolve);
    });
};

const waitFor = async (predicate: () => boolean): Promise<void> => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        if (predicate()) {
            return;
        }
        await flushPromises();
    }

    throw new Error('Condition not met');
};

class FakeAdapter implements CaptureAdapter {
    public readonly id = 'fake';
    public readonly label = 'Fake Adapter';
    public readonly startOptions: CaptureAdapterStartOptions[] = [];
    public readonly events: CaptureAdapterEvents[] = [];
    public startDeferred: Deferred<void> | null = null;
    public stopDeferred: Deferred<RecordingResult> | null = null;
    public stopResult: RecordingResult | null = null;

    public startRecording = vi.fn(async (options: CaptureAdapterStartOptions, events: CaptureAdapterEvents) => {
        this.startOptions.push(options);
        this.events.push(events);

        if (this.startDeferred) {
            await this.startDeferred.promise;
        }
    });

    public stopRecording = vi.fn(async () => {
        if (this.stopDeferred) {
            return this.stopDeferred.promise;
        }

        if (this.stopResult) {
            return this.stopResult;
        }

        const lastOptions = this.startOptions[this.startOptions.length - 1];

        return {
            filePath: lastOptions?.outputPath ?? 'unknown.wav',
            format: lastOptions?.format ?? DEFAULT_WAV_FORMAT,
        };
    });

    public emitProgress(index: number, progress: RecordingProgress): void {
        this.events[index]?.onProgress?.(progress);
    }

    public emitLevel(index: number, level: RecordingLevel): void {
        this.events[index]?.onLevel?.(level);
    }

    public emitError(index: number, error: Error): void {
        this.events[index]?.onError?.(error);
    }
}

describe('RecordingService', () => {
    let adapter: FakeAdapter;

    beforeEach(async () => {
        mockUserDataPath = await fs.mkdtemp(path.join(tmpdir(), 'finelistener-test-'));
        adapter = new FakeAdapter();
    });

    afterEach(async () => {
        await fs.rm(mockUserDataPath, { recursive: true, force: true });
    });

    it('forwards current session events and ignores stale ones', async () => {
        const onProgress = vi.fn();
        const onLevel = vi.fn();
        const onError = vi.fn();
        const service = new RecordingService(adapter, { onProgress, onLevel, onError });

        await service.startRecording();

        adapter.emitProgress(0, { durationMs: 1200, bytesWritten: 2048 });
        adapter.emitLevel(0, { rms: 0.2, peak: 0.9, clipped: false });

        expect(onProgress).toHaveBeenCalledWith({ durationMs: 1200, bytesWritten: 2048 });
        expect(onLevel).toHaveBeenCalledWith({ rms: 0.2, peak: 0.9, clipped: false });

        await service.stopRecording();

        onProgress.mockClear();
        onLevel.mockClear();
        onError.mockClear();

        await service.startRecording();

        adapter.emitProgress(0, { durationMs: 2500 });
        adapter.emitError(0, new Error('stale'));
        await flushPromises();

        expect(onProgress).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
        expect(service.getState()).toBe('recording');

        adapter.emitProgress(1, { durationMs: 3000 });

        expect(onProgress).toHaveBeenCalledWith({ durationMs: 3000 });
    });

    it('handles adapter error by stopping, clearing session, and returning idle', async () => {
        const onError = vi.fn();
        const service = new RecordingService(adapter, { onError });
        const session = await service.startRecording();

        adapter.stopResult = { filePath: session.filePath, format: session.format };
        adapter.emitError(0, new Error('boom'));
        await flushPromises();

        expect(onError).toHaveBeenCalledTimes(1);
        expect(adapter.stopRecording).toHaveBeenCalledTimes(1);
        expect(service.getState()).toBe('idle');
        expect(service.getCurrentSession()).toBeNull();

        const result = await service.stopRecording();

        expect(result.filePath).toBe(session.filePath);
        expect(result.sessionId).toBe(session.sessionId);
    });

    it('makes stopRecording idempotent', async () => {
        const service = new RecordingService(adapter);

        await service.startRecording();

        const stopDeferred = createDeferred<RecordingResult>();

        adapter.stopDeferred = stopDeferred;

        const stopPromise = service.stopRecording();
        const secondStopPromise = service.stopRecording();

        expect(stopPromise).not.toBe(secondStopPromise);
        expect(adapter.stopRecording).toHaveBeenCalledTimes(1);

        stopDeferred.resolve({
            filePath: adapter.startOptions[0].outputPath,
            format: adapter.startOptions[0].format,
        });

        const [firstResult, secondResult] = await Promise.all([stopPromise, secondStopPromise]);

        expect(firstResult).toStrictEqual(secondResult);
        expect(service.getState()).toBe('idle');
    });

    it('allows stop during starting without switching to recording', async () => {
        const service = new RecordingService(adapter);
        const startDeferred = createDeferred<void>();

        adapter.startDeferred = startDeferred;

        const startPromise = service.startRecording();

        await waitFor(() => adapter.startOptions.length > 0);

        expect(service.getState()).toBe('starting');
        expect(service.getCurrentSession()).not.toBeNull();

        const stopPromise = service.stopRecording();

        startDeferred.resolve();
        await stopPromise;

        expect(service.getState()).toBe('idle');
        await startPromise;

        expect(service.getState()).toBe('idle');
        expect(service.getCurrentSession()).toBeNull();
    });

    it('reports stopRecording errors to callbacks', async () => {
        const onError = vi.fn();
        const service = new RecordingService(adapter, { onError });

        await service.startRecording();

        const stopDeferred = createDeferred<RecordingResult>();
        const stopError = new Error('stop failed');

        adapter.stopDeferred = stopDeferred;

        const stopPromise = service.stopRecording();

        stopDeferred.reject(stopError);

        await expect(stopPromise).rejects.toThrow('stop failed');
        expect(onError).toHaveBeenCalledWith(stopError);
        expect(service.getState()).toBe('error');
    });

    it('adds a suffix when fileName already exists', async () => {
        const service = new RecordingService(adapter);
        const recordingsDir = path.join(mockUserDataPath, 'recordings');
        const existingPath = path.join(recordingsDir, 'take.wav');

        await fs.mkdir(recordingsDir, { recursive: true });
        await fs.writeFile(existingPath, '');

        const session = await service.startRecording({ fileName: 'take.wav' });

        expect(path.basename(session.filePath)).toBe('take-1.wav');

        await service.stopRecording();
    });
});
