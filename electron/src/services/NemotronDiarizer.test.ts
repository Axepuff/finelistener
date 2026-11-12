import fs from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { analyzeNemotron } from './NemotronDiarizer';
import { runSpeakerProcess } from './speakerProcess';

vi.mock('./speakerProcess', async (original) => ({
    ...await original<typeof import('./speakerProcess')>(), runSpeakerProcess: vi.fn(),
}));

let directory: string;
let wav: string;
let segments: unknown[];
const doctor = { version: '0.3.0', features: { backend_vulkan: true, backend_cuda: false },
    driver_runtime_compatible: true, devices: [{ name: 'CPU', type: 'cpu' }, { name: 'Vulkan0', type: 'gpu' }] };

beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(tmpdir(), 'nemotron protocol '));
    wav = path.join(directory, 'audio.wav');
    const audio = Buffer.alloc(44 + 32000);
    audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
    audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
    audio.writeUInt32LE(16000, 24); audio.writeUInt32LE(32000, 28);
    audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(32000, 40);
    await fs.writeFile(wav, audio);
    segments = [{ start: 0, end: 0.8, speaker: 7 }, { start: 0.2, end: 1, speaker: 'voice-x' }];
    vi.mocked(runSpeakerProcess).mockReset().mockImplementation(async (_binary, args) => {
        if (args.includes('doctor')) return { stdout: JSON.stringify(doctor), stderr: '' };
        await fs.writeFile(args[args.indexOf('--output') + 1], JSON.stringify({ segments }));
        return { stdout: '', stderr: '' };
    });
});

afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

it.each([
    ['win-x64-gpu', 10_000],
    ['mac-arm64', 180_000],
] as const)('bounds the %s doctor before CPU analysis and waits for it to close', async (variant, deadline) => {
    vi.useFakeTimers();
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
        const timeout = new AbortController();
        setTimeout(() => timeout.abort(), milliseconds);
        return timeout.signal;
    });
    let probeSignal: AbortSignal | undefined;
    let closeProbe: () => void = () => undefined;
    let notifyStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    vi.mocked(runSpeakerProcess).mockImplementationOnce((_binary, _args, signal) => {
        probeSignal = signal;
        notifyStarted();
        return new Promise((_resolve, reject) => { closeProbe = () => reject(new Error('Doctor closed')); });
    });
    const settled = vi.fn();
    const pending = analyzeNemotron(directory, variant, 'cpu', wav, controller.signal).then(settled, settled);
    try {
        await started;
        await vi.advanceTimersByTimeAsync(deadline - 1);
        expect(probeSignal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(probeSignal?.aborted).toBe(true);
        expect(settled).not.toHaveBeenCalled();
        closeProbe();
        await pending;
        expect(settled).toHaveBeenCalledWith(expect.objectContaining({ code: 'SPEAKER_ASSETS_UNAVAILABLE' }));
        expect(runSpeakerProcess).toHaveBeenCalledOnce();
        expect(controller.signal.aborted).toBe(false);
    } finally {
        controller.abort();
        closeProbe();
        await pending;
        vi.useRealTimers();
    }
});

it('does not apply the completed doctor deadline to inference', async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
        const timeout = new AbortController();
        setTimeout(() => timeout.abort(), milliseconds);
        return timeout.signal;
    });
    const nativeProcess = vi.mocked(runSpeakerProcess).getMockImplementation()!;
    let finishInference: () => void = () => undefined;
    const inference = new Promise<void>((resolve) => { finishInference = resolve; });
    let notifyStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    let inferenceSignal: AbortSignal | undefined;
    vi.mocked(runSpeakerProcess).mockImplementation(async (...args) => {
        if (!args[1].includes('doctor')) {
            inferenceSignal = args[2];
            notifyStarted();
            await inference;
            inferenceSignal.throwIfAborted();
        }
        return nativeProcess(...args);
    });
    const pending = analyzeNemotron(directory, 'win-x64-gpu', 'cpu', wav, new AbortController().signal);
    try {
        await started;
        await vi.advanceTimersByTimeAsync(180_000);
        expect(inferenceSignal?.aborted).toBe(false);
        finishInference();
        await expect(pending).resolves.toMatchObject({ backend: 'cpu' });
    } finally {
        finishInference();
        await Promise.allSettled([pending]);
        vi.useRealTimers();
    }
});

it('preserves overlapping native evidence, arbitrary IDs and pinned GPU provenance in one stateful run', async () => {
    const progress = vi.fn();
    const result = await analyzeNemotron(directory, 'win-x64-gpu', 'gpu', wav, new AbortController().signal, progress);
    expect(result).toMatchObject({ engine: 'nemotron-3', backend: 'vulkan', device: 'vulkan:0',
        preset: 'v3-offline', intervals: [
            { startSec: 0, endSec: 0.8, speakerId: '7' },
            { startSec: 0.2, endSec: 1, speakerId: 'voice-x' },
        ] });
    const [, args, , work, env] = vi.mocked(runSpeakerProcess).mock.calls[1];
    expect(args).toEqual(['diarize', wav, '--model', path.join(directory, 'model/Nemotron-3-Diarization.q8_0.gguf'),
        '--device', 'vulkan:0', '--preset', 'v3-offline', '--concurrency', '1', '--format', 'json',
        '--output', path.join(work, 'result.json')]);
    expect(env?.OMP_THREAD_LIMIT).toBe('2');
    expect(env?.NEMO_SPEECH_DIAR_PRESET).toBeUndefined();
    expect(progress.mock.calls).toEqual([[{ phase: 'analyzing' }]]);
    expect(runSpeakerProcess).toHaveBeenCalledTimes(2);
    await expect(fs.access(work)).rejects.toThrow();
});

it('accepts empty acoustic output for silent audio', async () => {
    segments = [];
    expect((await analyzeNemotron(directory, 'win-x64-gpu', 'gpu', wav, new AbortController().signal)).intervals).toEqual([]);
});

it.each([
    { start: -0.1, end: 1, speaker: 1 },
    { start: 0, end: 1.2, speaker: 1 },
    { start: 0.5, end: 0.5, speaker: 1 },
    { start: 0, end: 1, speaker: null },
    { start: 0, end: 1, speaker: '' },
])('rejects malformed native evidence without saving partial results: %j', async (segment) => {
    segments.push(segment);
    await expect(analyzeNemotron(directory, 'win-x64-gpu', 'gpu', wav, new AbortController().signal))
        .rejects.toMatchObject({ code: 'SPEAKER_GPU_FAILED' });
});

it('refuses an explicitly requested GPU when only CPU is available', async () => {
    vi.mocked(runSpeakerProcess).mockResolvedValue({ stdout: JSON.stringify({ ...doctor,
        devices: [{ name: 'CPU', type: 'cpu' }] }), stderr: '' });
    await expect(analyzeNemotron(directory, 'win-x64-gpu', 'gpu', wav, new AbortController().signal))
        .rejects.toMatchObject({ code: 'SPEAKER_GPU_UNAVAILABLE' });
    expect(runSpeakerProcess).toHaveBeenCalledOnce();
});

it('does not retry a failed GPU process on CPU and removes its temporary output', async () => {
    vi.mocked(runSpeakerProcess).mockResolvedValueOnce({ stdout: JSON.stringify(doctor), stderr: '' })
        .mockRejectedValueOnce(new Error('GPU initialization failed'));
    await expect(analyzeNemotron(directory, 'win-x64-gpu', 'gpu', wav, new AbortController().signal))
        .rejects.toMatchObject({ code: 'SPEAKER_GPU_FAILED' });
    expect(runSpeakerProcess).toHaveBeenCalledTimes(2);
    await expect(fs.access(vi.mocked(runSpeakerProcess).mock.calls[1][3])).rejects.toThrow();
});

it.each([
    ['win-x64-cpu', 'auto', false, 'cpu', 'cpu'],
    ['win-x64-gpu', 'auto', false, 'cpu', 'cpu'],
    ['win-x64-gpu', 'cpu', true, 'cpu', 'cpu'],
    ['mac-arm64', 'cpu', true, 'cpu', 'cpu'],
    ['mac-arm64', 'auto', false, 'cpu', 'cpu'],
    ['mac-arm64', 'auto', true, 'metal', 'metal'],
] as const)('runs %s in %s mode with GPU availability %s and records the actual backend', async (variant, compute, gpuAvailable, backend, device) => {
    const status = { ...doctor,
        features: { backend_cuda: false, backend_vulkan: variant === 'win-x64-gpu', backend_metal: variant === 'mac-arm64' },
        driver_runtime_compatible: gpuAvailable || variant === 'win-x64-cpu',
        devices: [{ name: 'CPU', type: 'cpu' }, ...(gpuAvailable ? [{ name: variant === 'mac-arm64' ? 'Metal' : 'Vulkan0', type: 'gpu' }] : [])],
    };
    vi.mocked(runSpeakerProcess).mockResolvedValueOnce({ stdout: JSON.stringify(status), stderr: '' });
    const result = await analyzeNemotron(directory, variant, compute, wav, new AbortController().signal);
    expect(result).toMatchObject({ backend, device, intervals: [
        { startSec: 0, endSec: 0.8, speakerId: '7' }, { startSec: 0.2, endSec: 1, speakerId: 'voice-x' },
    ] });
    const [binary, args] = vi.mocked(runSpeakerProcess).mock.calls[1];
    expect(binary).toBe(path.join(directory, variant === 'mac-arm64' ? 'bin/nemo-speech' : 'bin/nemo-speech.exe'));
    expect(args[args.indexOf('--device') + 1]).toBe(device);
    expect(runSpeakerProcess).toHaveBeenCalledTimes(2);
});
