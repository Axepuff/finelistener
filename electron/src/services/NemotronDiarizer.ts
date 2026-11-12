import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { SessionSpeakerInterval } from '../types/sessions';
import type { SpeakerCompute, SpeakerGpuBackend } from '../types/transcription';
import type { SpeakerAnalysisProgress } from './SpeakerDiarizationService';
import { runSpeakerProcess, SpeakerAnalysisError } from './speakerProcess';

export const NEMOTRON_COMPONENT = {
    version: 'nemotron-3-nemo030-q8-r3',
    modelRevision: '52a432672732425e4c19765b9fec9b5810e6f4ba',
    modelSha256: '08456d9e22cd9a323c0364d98375f3746d6e68507ebb705cd46438c534c7a3a1',
    model: 'model/Nemotron-3-Diarization.q8_0.gguf',
} as const;

export const NEMOTRON_RUNTIMES = {
    'win-x64-cpu': { executable: 'bin/nemo-speech.exe', gpuBackend: null,
        revision: 'nemo-speech-0.3.0+utf8.1', sha256: '4ed9740e361e4653f56c3dce7d1e81883a1c8b831c1bd7d01567fff1130b5b05' },
    'win-x64-gpu': { executable: 'bin/nemo-speech.exe', gpuBackend: 'vulkan',
        revision: 'nemo-speech-0.3.0+utf8.1', sha256: '72b3b8b41bfe2be0320eff4e9d310594e4f99deefcde4a157799a039656963ce' },
    'mac-arm64': { executable: 'bin/nemo-speech', gpuBackend: 'metal',
        revision: 'nemo-speech-0.3.0', sha256: '2b972ed8b5dba07492212acf8cb75cbf34ecb141198ffa1997febe84b7c4d9ed' },
} as const;

export type NemotronVariant = keyof typeof NEMOTRON_RUNTIMES;

export interface NemotronAnalysisResult {
    engine: 'nemotron-3';
    backend: 'cpu' | SpeakerGpuBackend;
    device: 'cpu' | 'vulkan:0' | 'metal';
    preset: 'v3-offline';
    intervals: SessionSpeakerInterval[];
    modelRevision: string;
    runtimeRevision: string;
    modelSha256: string;
    runtimeSha256: string;
}

const environment = (root: string): NodeJS.ProcessEnv => {
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
    // Do not inherit CLI configuration, backend overrides or another engine's DLL search path.
    return {
        ...(process.platform === 'win32' ? { SystemRoot: systemRoot, WINDIR: systemRoot,
            USERPROFILE: process.env.USERPROFILE, LOCALAPPDATA: process.env.LOCALAPPDATA } : { HOME: os.homedir() }),
        TEMP: os.tmpdir(), TMP: os.tmpdir(),
        // Prefer the driver's system Vulkan loader; the pinned fallback also lets CPU start without a GPU driver.
        PATH: process.platform === 'win32' ? [path.join(root, 'bin'), path.join(systemRoot, 'System32'), systemRoot,
            path.join(root, 'vulkan-loader')].join(path.delimiter) : '/usr/bin:/bin',
        OMP_NUM_THREADS: '2', OMP_THREAD_LIMIT: '2', OPENBLAS_NUM_THREADS: '2', MKL_NUM_THREADS: '2',
        GGML_VK_DISABLE_GRAPH_OPTIMIZE: '1',
    };
};

export const inspectNemotron = async (root: string, variant: NemotronVariant, signal: AbortSignal): Promise<{ gpuAvailable: boolean }> => {
    const runtime = NEMOTRON_RUNTIMES[variant];
    try {
        // Doctor exits 1 when an accelerator is missing, even though CPU inference is available.
        const output = await runSpeakerProcess(path.join(root, runtime.executable),
            ['--json', 'doctor'], signal, root, environment(root), 100_000, true, [0, 1]);
        const status = JSON.parse(output.stdout) as {
            version?: string; features?: { backend_vulkan?: boolean; backend_cuda?: boolean; backend_metal?: boolean };
            devices?: Array<{ name?: string; type?: string }>; driver_runtime_compatible?: boolean;
        };
        const gpu = status.devices?.find((device) => device.type === 'gpu' || device.type === 'integrated-gpu');
        if (status.version !== '0.3.0' || status.features?.backend_cuda
            || Boolean(status.features?.backend_vulkan) !== (runtime.gpuBackend === 'vulkan')
            || Boolean(status.features?.backend_metal) !== (runtime.gpuBackend === 'metal')
            || !status.devices?.some((device) => device.type === 'cpu')) {
            throw new Error('The native runtime does not match the pinned capabilities');
        }
        return { gpuAvailable: Boolean(runtime.gpuBackend && status.driver_runtime_compatible && gpu
            && (runtime.gpuBackend !== 'vulkan' || gpu.name === 'Vulkan0')) };
    } catch (error) {
        signal.throwIfAborted();
        throw new SpeakerAnalysisError('SPEAKER_ASSETS_UNAVAILABLE', { cause: error });
    }
};

const preparedDuration = async (wavPath: string): Promise<number> => {
    const file = await fs.open(wavPath, 'r');
    try {
        const { size } = await file.stat();
        const header = Buffer.alloc(24);
        await file.read(header, 0, 12, 0);
        if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') {
            throw new Error('Expected a prepared PCM WAV');
        }
        let validFormat = false;
        for (let offset = 12; offset + 8 <= size;) {
            await file.read(header, 0, 8, offset);
            const name = header.toString('ascii', 0, 4);
            const bytes = header.readUInt32LE(4);
            if (offset + 8 + bytes > size) throw new Error('Truncated prepared WAV');
            if (name === 'fmt ' && bytes >= 16) {
                await file.read(header, 0, 16, offset + 8);
                validFormat = header.readUInt16LE(0) === 1 && header.readUInt16LE(2) === 1
                    && header.readUInt32LE(4) === 16000 && header.readUInt16LE(14) === 16;
            }
            if (name === 'data' && validFormat && bytes % 2 === 0) return bytes / 32000;
            offset += 8 + bytes + bytes % 2;
        }
        throw new Error('Prepared WAV has no PCM data');
    } finally { await file.close(); }
};

const parseIntervals = (json: string, duration: number): SessionSpeakerInterval[] => {
    const result = JSON.parse(json) as { segments?: Array<{ start: number; end: number; speaker: unknown }> };
    if (!Array.isArray(result.segments) || result.segments.length > 100_000) throw new Error('Invalid Nemotron segments');
    return result.segments.map((segment) => {
        const id = segment?.speaker;
        if (!segment || !Number.isFinite(segment.start) || !Number.isFinite(segment.end)
            || segment.start < 0 || segment.end <= segment.start || segment.start >= duration
            || segment.end > duration + 0.01
            || !((typeof id === 'number' && Number.isSafeInteger(id) && id >= 0)
                || (typeof id === 'string' && id.trim().length > 0 && id.length <= 200))) {
            throw new Error('Invalid Nemotron interval');
        }
        // CLI JSON rounds to milliseconds. Only this rounding allowance is clipped to the audio boundary.
        return { startSec: segment.start, endSec: Math.min(duration, segment.end), speakerId: String(id) };
    });
};

export const analyzeNemotron = async (root: string, variant: NemotronVariant, compute: SpeakerCompute, wavPath: string, signal: AbortSignal,
    onProgress?: (progress: SpeakerAnalysisProgress) => void): Promise<NemotronAnalysisResult> => {
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'finelistener-nemotron-'));
    const runtime = NEMOTRON_RUNTIMES[variant];
    let backend: NemotronAnalysisResult['backend'] = 'cpu';
    try {
        const { gpuAvailable } = await inspectNemotron(root, variant, signal);
        if (compute === 'gpu' && !gpuAvailable) throw new SpeakerAnalysisError('SPEAKER_GPU_UNAVAILABLE');
        if (compute !== 'cpu' && gpuAvailable && runtime.gpuBackend) backend = runtime.gpuBackend;
        const device = backend === 'vulkan' ? 'vulkan:0' : backend;
        const duration = await preparedDuration(wavPath);
        const outputPath = path.join(work, 'result.json');
        onProgress?.({ phase: 'analyzing' });
        let intervals: SessionSpeakerInterval[] = [];
        if (duration > 0) {
            const started = performance.now();
            // Auto selects once, before inference. A failed GPU run never silently retries on CPU.
            await runSpeakerProcess(path.join(root, runtime.executable), [
                'diarize', wavPath, '--model', path.join(root, NEMOTRON_COMPONENT.model),
                '--device', device, '--preset', 'v3-offline', '--concurrency', '1',
                '--format', 'json', '--output', outputPath,
            ], signal, work, environment(root), 100_000, true);
            if ((await fs.stat(outputPath)).size > 16_000_000) throw new Error('Nemotron output exceeded the limit');
            intervals = parseIntervals(await fs.readFile(outputPath, 'utf8'), duration);
            console.info('Nemotron analysis completed', { backend, seconds: (performance.now() - started) / 1000,
                duration, intervals: intervals.length });
        }
        signal.throwIfAborted();
        return { engine: 'nemotron-3', backend, device, preset: 'v3-offline',
            intervals, modelRevision: NEMOTRON_COMPONENT.modelRevision,
            runtimeRevision: runtime.revision, modelSha256: NEMOTRON_COMPONENT.modelSha256,
            runtimeSha256: runtime.sha256 };
    } catch (error) {
        signal.throwIfAborted();
        if (error instanceof SpeakerAnalysisError) throw error;
        throw new SpeakerAnalysisError(backend === 'cpu' ? 'SPEAKER_ANALYSIS_FAILED' : 'SPEAKER_GPU_FAILED', { cause: error });
    } finally { await fs.rm(work, { recursive: true, force: true }); }
};
