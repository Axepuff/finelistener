import { EventEmitter } from 'events';
import { beforeEach, expect, it, vi } from 'vitest';
import { Whisper } from './Whisper';
import { transcribeSessionSources } from '../SessionTranscriptionRunner';
import type { SessionDetails, SessionTranscriptV1 } from '../../types/sessions';

const mocks = vi.hoisted(() => ({
    spawn: vi.fn(),
    inference: vi.fn(),
    prepareAudio: vi.fn<(audioPath: string, segment: unknown, options: unknown) => Promise<{ wavPath: string; cleanup: () => Promise<void> }>>(),
    readFile: vi.fn<() => Promise<Uint8Array>>(),
}));

vi.mock('child_process', () => ({ spawn: mocks.spawn }));
vi.mock('fs/promises', () => ({ default: { readFile: mocks.readFile } }));
vi.mock('../../utils/whisper', () => ({
    resolveWhisperPaths: () => ({ serverBinPath: 'whisper', modelPath: 'model', vadModelPath: 'vad' }),
    createWhisperEnv: () => ({}),
}));
vi.mock('../AudioPreprocessor', () => ({
    AudioPreprocessor: class {
        prepareAudioFile(audioPath: string, segment: unknown, options: unknown) {
            return mocks.prepareAudio(audioPath, segment, options);
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
    mocks.readFile.mockReset().mockResolvedValue(new Uint8Array([1]));
    mocks.prepareAudio.mockReset().mockResolvedValue({ wavPath: 'audio.wav', cleanup: () => Promise.resolve() });
    vi.spyOn(process, 'on').mockReturnValue(process);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

const createSourceSession = () => {
    const session: SessionDetails = {
        id: 'recording', title: 'Recording', createdAt: 0, updatedAt: 0, sourceKind: 'recorded',
        hasTranscript: false, audioOriginalPath: 'mix.wav', audioWavPath: 'mix.wav',
        tracks: [
            { source: 'system', filePath: 'system.wav', startOffsetMs: 0 },
            { source: 'microphone', filePath: 'microphone.wav', startOffsetMs: 0 },
        ],
    };
    return {
        getSession: () => Promise.resolve(structuredClone(session)),
        saveTranscript: (_id: string, transcript: SessionTranscriptV1) => {
            session.transcript = structuredClone(transcript);
            return Promise.resolve();
        },
    };
};

const silentPreparedWav = (): Buffer => {
    const wav = Buffer.alloc(44 + 32000);
    wav.write('RIFF');
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(16000, 24);
    wav.writeUInt32LE(32000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(32000, 40);
    return wav;
};

it('passes the microphone gate into audio preparation', async () => {
    const runner = new Whisper({});
    mocks.spawn.mockReturnValue(createProcess());
    mocks.inference.mockResolvedValue({ ok: true, text: 'Local speech' });

    await runner.transcribe('microphone.wav', { runId: 1, language: 'ru', microphoneGateEnabled: true });

    expect(mocks.prepareAudio).toHaveBeenCalledWith('microphone.wav', undefined,
        expect.objectContaining({ microphoneGate: true }));
});

it('completes digital silence without inference and still recognizes the microphone source', async () => {
    const runner = new Whisper({});
    mocks.spawn.mockReturnValue(createProcess());
    mocks.readFile.mockResolvedValueOnce(silentPreparedWav()).mockResolvedValueOnce(new Uint8Array([1]));
    mocks.inference.mockResolvedValue({ ok: true, text: 'Microphone speech' });
    const result = await transcribeSessionSources('recording', { runId: 1, language: 'ru', useVad: true }, createSourceSession(),
        (audioPath, opts) => runner.transcribe(audioPath, opts), new AbortController().signal);
    expect(mocks.inference).toHaveBeenCalledTimes(1);
    expect(result.transcript?.segments).toEqual([
        { startSec: 0, endSec: null, text: 'Microphone speech', source: 'microphone' },
    ]);
    expect(result.transcript?.sourceRun?.status).toBe('completed');
});

it('completes an empty VAD source and restarts the failed server before recognizing microphone speech', async () => {
    const first = createProcess();
    const second = createProcess();
    const runner = new Whisper({});
    const repository = createSourceSession();
    mocks.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);
    mocks.inference.mockImplementationOnce(() => {
        first.stderr.emit('data', 'whisper_vad_segments_from_probs: Final speech segments after filtering: 0\n');
        // The socket can fail before the child close event updates the server state.
        setTimeout(() => first.emit('close', 3221225477), 0);
        return Promise.reject(new Error('fetch failed'));
    }).mockImplementationOnce(() => {
        if (mocks.spawn.mock.calls.length < 2) return Promise.reject(new Error('Server has already crashed'));
        return Promise.resolve({ ok: true, text: '[00:00:00.000 --> 00:00:01.000] Microphone speech' });
    });
    const result = await transcribeSessionSources('recording', { runId: 1, language: 'ru', useVad: true }, repository,
        (audioPath, opts) => runner.transcribe(audioPath, opts), new AbortController().signal);
    expect(result.transcript?.segments).toEqual([
        { startSec: 0, endSec: 1, text: 'Microphone speech', source: 'microphone' },
    ]);
    expect(result.transcript?.sourceRun?.status).toBe('completed');
    expect(result.transcript?.sourceRun?.sources[0]).toMatchObject({ status: 'completed', segments: [] });
});

it('finishes a nonzero audio source when split zero-VAD output precedes a hanging inference', async () => {
    const child = createProcess();
    const runner = new Whisper({});
    mocks.spawn.mockReturnValue(child);
    child.kill.mockImplementation(() => {
        setTimeout(() => child.emit('close', 0), 0);
        return true;
    });
    mocks.inference.mockImplementation((_payload: unknown, signal: AbortSignal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        child.stderr.emit('data', 'whisper_vad_segments_from_probs: Final speech segments after fil');
        child.stderr.emit('data', 'tering: 0\n');
    }));
    await expect(runner.transcribe('noise.wav', { runId: 1, language: 'ru', useVad: true })).resolves.toBe('');
    expect(child.kill).toHaveBeenCalledWith('SIGINT');
});

it('does not carry an empty VAD result into another request or hide unrelated failures', async () => {
    const first = createProcess();
    const second = createProcess();
    const runner = new Whisper({});
    mocks.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);
    mocks.inference.mockImplementationOnce(() => {
        first.stderr.emit('data', 'whisper_vad_segments_from_probs: Final speech segments after filtering: 0\n');
        first.emit('close', 3221225477);
        return Promise.reject(new Error('Native crash'));
    });
    await expect(runner.transcribe('noise.wav', { runId: 1, language: 'ru', useVad: true })).resolves.toBe('');
    mocks.inference.mockImplementationOnce(() => {
        first.stderr.emit('data', 'whisper_vad_segments_from_probs: Final speech segments after filtering: 0\n');
        second.stderr.emit('data', 'whisper_vad_segments_from_probs: Final speech segments after filtering: 2\n');
        second.emit('close', 1);
        return Promise.reject(new Error('Unrelated inference failure'));
    });
    await expect(runner.transcribe('microphone.wav', { runId: 2, language: 'ru', useVad: true }))
        .rejects.toThrow('Unrelated inference failure');
});

it('preserves cancellation even when VAD reports zero speech', async () => {
    const child = createProcess();
    const runner = new Whisper({});
    mocks.spawn.mockReturnValue(child);
    mocks.inference.mockImplementation((_payload: unknown, signal: AbortSignal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        child.stderr.emit('data', 'whisper_vad_segments_from_probs: Final speech segments after filtering: 0\n');
        runner.stop();
        child.emit('close', 0);
    }));
    await expect(runner.transcribe('noise.wav', { runId: 1, language: 'ru', useVad: true }))
        .rejects.toThrow('Transcription was stopped');
});

it('does not discard quiet nonzero PCM samples', async () => {
    const runner = new Whisper({});
    const audio = silentPreparedWav();
    audio.writeInt16LE(1, 44);
    mocks.readFile.mockResolvedValue(audio);
    mocks.spawn.mockReturnValue(createProcess());
    mocks.inference.mockResolvedValue({ ok: true, text: 'Quiet speech' });
    await expect(runner.transcribe('quiet.wav', { runId: 1, language: 'ru' })).resolves.toBe('Quiet speech');
    expect(mocks.inference).toHaveBeenCalledOnce();
});

it('cancels during audio preparation without starting inference and releases the prepared file', async () => {
    const runner = new Whisper({});
    mocks.spawn.mockReturnValue(createProcess());
    let prepared: (value: { wavPath: string; cleanup: () => Promise<void> }) => void = () => undefined;
    let signalPreparation: () => void = () => undefined;
    const started = new Promise<void>((resolve) => { signalPreparation = resolve; });
    mocks.prepareAudio.mockImplementation(() => {
        signalPreparation();
        return new Promise((resolve) => { prepared = resolve; });
    });
    const cleanup = vi.fn(() => Promise.resolve());
    const run = runner.transcribe('audio.wav', { runId: 1, language: 'en' });
    await started;
    expect(runner.stop()).toBe(true);
    prepared({ wavPath: 'audio.wav', cleanup });
    await expect(run).rejects.toThrow('Transcription was stopped');
    expect(mocks.inference).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
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
