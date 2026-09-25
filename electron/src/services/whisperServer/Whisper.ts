import fs from 'fs/promises';
import path from 'path';
import { AudioPreprocessor } from '../../services/AudioPreprocessor';
import type { TranscribeOpts } from '../../types/transcription';
import { createWhisperEnv, resolveWhisperPaths } from '../../utils/whisper';
import { createProgressParser } from '../progress';
import { TranscriptStreamParser } from './TranscriptStreamParser';
import { WhisperModelManager } from './WhisperModelManager';
import { WhisperServerApiClient } from './WhisperServerApiClient';
import { WhisperServerProcess } from './WhisperServerProcess';
import type { TranscriptionCallbacks } from './types';
import { normalizeChunk } from './utils';
import { isSilentPcmWav } from './pcmSilence';

const SERVER_HOST = '127.0.0.1';
const SERVER_PORT = 17895;

interface WhisperServerParams {
    serverBinPath: string;
    modelPath: string;
    vadModelPath: string;
    useGpu?: boolean;
}

export class Whisper {
    private readonly apiClient: WhisperServerApiClient;
    private readonly modelManager: WhisperModelManager;
    private readonly serverProcess: WhisperServerProcess;
    private readonly streamParser: TranscriptStreamParser;
    private readonly audioPreprocessor: AudioPreprocessor;
    private abortController: AbortController | null = null;
    private isTranscribing = false;
    private readonly callbacks: TranscriptionCallbacks;
    private parseProgress: (value: string) => void = () => undefined;
    private activeRunId: number | null = null;
    private hasRealtimeOutput = false;
    private noSpeechController: AbortController | null = null;
    private stderrLineBuffer = '';
    private readonly handleProcessExit = () => {
        this.stopServer();
    };
    private readonly handleServerExit = (code: number | null) => {
        this.callbacks.onStderrChunk?.(`whisper-server has terminated (code: ${code ?? 'unknown'})`);
        this.modelManager.reset();
    };

    constructor(callbacks: TranscriptionCallbacks) {
        this.callbacks = callbacks;
        this.apiClient = new WhisperServerApiClient(this.baseUrl);
        this.audioPreprocessor = new AudioPreprocessor();
        this.serverProcess = new WhisperServerProcess({
            onStdoutData: this.createOutputHandler('stdout'),
            onStderrData: this.createOutputHandler('stderr'),
            onExit: this.handleServerExit,
        });
        this.streamParser = new TranscriptStreamParser();
        this.modelManager = new WhisperModelManager({
            apiClient: this.apiClient,
            isServerRunning: () => this.serverProcess.isRunning(),
            onLog: this.callbacks.onStderrChunk,
        });

        process.on('beforeExit', this.handleProcessExit);
        process.on('exit', this.handleProcessExit);
    }

    public stop(): boolean {
        return this.abortInference();
    }

    public stopServer(): boolean {
        const stopped = this.serverProcess.stop();

        if (stopped) {
            this.modelManager.reset();
        }

        return stopped;
    }

    public async transcribe(audioPath: string, opts: TranscribeOpts): Promise<string> {
        if (this.isTranscribing) {
            throw new Error('Previous transcription is not finished yet');
        }

        this.isTranscribing = true;
        const operation = new AbortController();
        this.abortController = operation;

        try {
            const resolved = resolveWhisperPaths(opts.model, opts.modelPath);

            await this.loadModelIfNeeded({
                serverBinPath: resolved.serverBinPath,
                modelPath: resolved.modelPath,
                vadModelPath: resolved.vadModelPath,
                useGpu: opts.useGpu,
            });
            operation.signal.throwIfAborted();

            const { wavPath, cleanup } = await this.audioPreprocessor.prepareAudioFile(
                audioPath,
                opts.segment,
                opts.optimized ?
                    { highPass: 80, lowPass: 12000, dynanorm: true, microphoneGate: opts.microphoneGateEnabled, signal: operation.signal } :
                    { highPass: undefined, microphoneGate: opts.microphoneGateEnabled, signal: operation.signal },
            );

            this.activeRunId = opts.runId;
            this.parseProgress = createProgressParser((value) => {
                this.callbacks.onProgressPercent?.({ runId: opts.runId, value });
            });
            this.hasRealtimeOutput = false;
            this.stderrLineBuffer = '';
            this.streamParser.reset();

            this.callbacks.onProgressPercent?.({ runId: opts.runId, value: 0 });

            try {
                operation.signal.throwIfAborted();
                const fileBuffer = await fs.readFile(wavPath);
                operation.signal.throwIfAborted();
                if (isSilentPcmWav(fileBuffer)) {
                    this.callbacks.onProgressPercent?.({ runId: opts.runId, value: 100 });
                    return '';
                }
                const safeBuffer = new Uint8Array(fileBuffer.byteLength);

                safeBuffer.set(fileBuffer);
                this.noSpeechController = new AbortController();
                const inferenceSignal = AbortSignal.any([operation.signal, this.noSpeechController.signal]);
                const inferenceResult = await this.apiClient.inference(
                    {
                        audioBuffer: safeBuffer,
                        fileName: path.basename(wavPath) || 'audio.wav',
                        options: opts,
                    },
                    inferenceSignal,
                );
                inferenceSignal.throwIfAborted();

                if (!inferenceResult.ok) {
                    throw new Error(
                        `whisper-server returned ${inferenceResult.status}: ${
                            inferenceResult.errorText || inferenceResult.statusText
                        }`,
                    );
                }

                const transcriptText = inferenceResult.text;

                if (!this.hasRealtimeOutput) {
                    this.callbacks.onStdoutChunk?.({ runId: opts.runId, chunk: transcriptText });
                }
                this.callbacks.onProgressPercent?.({ runId: opts.runId, value: 100 });

                return transcriptText;
            } catch (error) {
                if (this.abortController === null && error instanceof Error && error.name === 'AbortError') {
                    throw new Error('Transcription was stopped by the user');
                }

                if (!operation.signal.aborted) {
                    // A failed socket can precede process close; release the server before the next source starts.
                    this.stopServer();
                    await this.serverProcess.waitForExit();
                    operation.signal.throwIfAborted();
                    if (this.noSpeechController?.signal.aborted) {
                        this.callbacks.onStderrChunk?.('Whisper detected no speech in this source. Saved an empty transcript.');
                        this.callbacks.onProgressPercent?.({ runId: opts.runId, value: 100 });
                        return '';
                    }
                }

                throw error instanceof Error ? error : new Error(String(error));
            } finally {
                this.noSpeechController = null;
                if (this.abortController) {
                    this.abortController = null;
                }
                await cleanup().catch(() => void 0);
            }
        } finally {
            this.abortController = null;
            this.activeRunId = null;
            this.isTranscribing = false;
        }
    }

    private get baseUrl(): string {
        return `http://${SERVER_HOST}:${SERVER_PORT}`;
    }

    private abortInference(): boolean {
        if (!this.abortController) return false;

        this.stopServer();

        this.activeRunId = null;
        this.abortController.abort();
        this.abortController = null;

        return true;
    }

    private handleStdoutChunk(text: string) {
        const runId = this.activeRunId;

        if (runId === null) return;

        const lines = this.streamParser.pushChunk(text);

        if (lines.length > 0) {
            this.hasRealtimeOutput = true;
        }

        for (const line of lines) {
            this.callbacks.onStdoutChunk?.({ runId, chunk: line });
        }
    }

    private createOutputHandler(source: 'stdout' | 'stderr') {
        return (chunk: unknown) => {
            const text = normalizeChunk(chunk);

            if (!text) return;

            if (source === 'stdout') {
                this.handleStdoutChunk(text);
            } else if (this.activeRunId !== null && this.noSpeechController) {
                this.stderrLineBuffer += text;
                const lines = this.stderrLineBuffer.split('\n');
                this.stderrLineBuffer = lines.pop() ?? '';
                for (const line of lines) {
                    const match = line.match(/^whisper_vad_segments_from_probs: Final speech segments after filtering: (\d+)\s*$/);
                    // This native result is definitive; avoid its subsequent empty-audio crash or hang.
                    if (match && Number(match[1]) === 0) this.noSpeechController.abort();
                }
            }
            this.callbacks.onStderrChunk?.(`[server:${source}] ${text}`);
            if (this.activeRunId !== null) {
                this.parseProgress(text);
            }
        };
    }

    public async startServer(params: WhisperServerParams) {
        const args = [
            '-m',
            params.modelPath,
            '--host',
            SERVER_HOST,
            '--port',
            String(SERVER_PORT),
            '--inference-path',
            '/inference',
            '--print-realtime',
            '--print-progress',
            '--vad',
            '--vad-model',
            params.vadModelPath,
        ];

        if (params.useGpu === false) {
            args.push('--no-gpu');
        }

        this.callbacks.onStderrChunk?.(`\nWhisper-server is running: ${args.join(' ')}`);
        console.log(args);

        this.serverProcess.start(
            params.serverBinPath,
            args,
            createWhisperEnv(params.serverBinPath),
        );

        await this.modelManager.onServerStarted(params.modelPath);
    }

    private async loadModelIfNeeded(paths: WhisperServerParams) {
        if (!this.serverProcess.isRunning()) {
            await this.serverProcess.waitForExit();
            await this.startServer(paths);

            return;
        }

        await this.modelManager.loadModelIfNeeded(paths.modelPath);
    }
}
