import { EventEmitter } from 'events';
import { beforeEach, expect, it, vi } from 'vitest';
import { Whisper } from './Whisper';

const mocks = vi.hoisted(() => ({
    spawn: vi.fn(),
    inference: vi.fn(),
}));

vi.mock('child_process', () => ({ spawn: mocks.spawn }));
vi.mock('fs/promises', () => ({ default: { readFile: vi.fn(() => Promise.resolve(new Uint8Array([1]))) } }));
vi.mock('../../utils/whisper', () => ({
    resolveWhisperPaths: () => ({ serverBinPath: 'whisper', modelPath: 'model', vadModelPath: 'vad' }),
    createWhisperEnv: () => ({}),
}));
vi.mock('../AudioPreprocessor', () => ({
    AudioPreprocessor: class {
        prepareAudioFile() {
            return Promise.resolve({ wavPath: 'audio.wav', cleanup: () => Promise.resolve() });
        }
    },
}));
vi.mock('./WhisperServerApiClient', () => ({
    WhisperServerApiClient: class {
        inference = mocks.inference;
    },
}));
vi.mock('./WhisperModelManager', () => ({
    WhisperModelManager: class {
        reset = vi.fn();
        onServerStarted = () => Promise.resolve();
        loadModelIfNeeded = () => Promise.resolve();
    },
}));

const createProcess = () => Object.assign(new EventEmitter(), {
    stdout: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
    stderr: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
    kill: vi.fn(() => true),
});

beforeEach(() => {
    mocks.spawn.mockReset();
    mocks.inference.mockReset();
    vi.spyOn(process, 'on').mockReturnValue(process);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

it('tags realtime and fallback output with the originating run id', async () => {
    const child = createProcess();
    const onStdoutChunk = vi.fn();
    const onProgressPercent = vi.fn();
    const runner = new Whisper({ onStdoutChunk, onProgressPercent });
    const text = '[00:00:00.000 --> 00:00:01.000] Actual text\n';

    mocks.spawn.mockReturnValue(child);
    mocks.inference.mockImplementationOnce(() => {
        child.stdout.emit('data', text);
        child.stderr.emit('data', 'progress = 35%');

        return Promise.resolve({ ok: true, text });
    });
    await expect(runner.transcribe('audio.wav', { runId: 11, language: 'en' })).resolves.toBe(text);
    expect(onStdoutChunk).toHaveBeenCalledWith({ runId: 11, chunk: text });
    expect(onProgressPercent).toHaveBeenCalledWith({ runId: 11, value: 35 });

    mocks.inference.mockResolvedValueOnce({ ok: true, text: 'Fallback text' });
    await runner.transcribe('audio.wav', { runId: 12, language: 'en' });
    expect(onStdoutChunk).toHaveBeenLastCalledWith({ runId: 12, chunk: 'Fallback text' });
    expect(onProgressPercent).toHaveBeenLastCalledWith({ runId: 12, value: 100 });
});

it('waits for the cancelled server to close and rejects its trailing output', async () => {
    const firstChild = createProcess();
    const secondChild = createProcess();
    const onStdoutChunk = vi.fn();
    const onProgressPercent = vi.fn();
    const runner = new Whisper({ onStdoutChunk, onProgressPercent });
    let signalInferenceStarted: () => void = () => undefined;
    const inferenceStarted = new Promise<void>((resolve) => { signalInferenceStarted = resolve; });

    mocks.spawn.mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);
    mocks.inference.mockImplementationOnce((_payload: unknown, signal: AbortSignal) => (
        new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
            signalInferenceStarted();
        })
    ));
    const firstRun = runner.transcribe('audio.wav', { runId: 21, language: 'en' });
    const firstResult = expect(firstRun).rejects.toThrow('Transcription was stopped');

    await inferenceStarted;
    firstChild.stdout.emit('data', '[00:00:00.000 --> 00:00:01.000] First draft\n');
    expect(runner.stop()).toBe(true);
    expect(firstChild.kill).toHaveBeenCalledWith('SIGINT');
    await firstResult;
    onStdoutChunk.mockClear();
    onProgressPercent.mockClear();

    const text = '[00:00:00.000 --> 00:00:01.000] Second draft\n';

    mocks.inference.mockImplementationOnce(() => {
        firstChild.stdout.emit('data', '[00:00:01.000 --> 00:00:02.000] Old text\n');
        firstChild.stderr.emit('data', 'progress = 99%');
        secondChild.stdout.emit('data', text);
        secondChild.stderr.emit('data', 'progress = 25%');

        return Promise.resolve({ ok: true, text });
    });
    const secondRun = runner.transcribe('audio.wav', { runId: 22, language: 'en' });

    await Promise.resolve();
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    firstChild.stdout.emit('data', '[00:00:01.000 --> 00:00:02.000] Trailing text\n');
    expect(onStdoutChunk).not.toHaveBeenCalled();
    firstChild.emit('close', 0);

    await expect(secondRun).resolves.toBe(text);
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    expect(onStdoutChunk.mock.calls).toEqual([[{ runId: 22, chunk: text }]]);
    expect(onProgressPercent).toHaveBeenCalledWith({ runId: 22, value: 25 });
    expect(onProgressPercent).not.toHaveBeenCalledWith(expect.objectContaining({ value: 99 }));
});
