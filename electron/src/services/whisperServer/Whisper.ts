import fs from 'fs/promises';
import path from 'path';
import type { TranscribeOpts } from '../../controllers/transcriptionController';
import { AudioPreprocessor } from '../../services/AudioPreprocessor';
import { createWhisperEnv, resolveWhisperPaths } from '../../utils/whisper';
import { createProgressParser } from '../progress';
import { TranscriptStreamParser } from './TranscriptStreamParser';
import { WhisperModelManager } from './WhisperModelManager';
import { WhisperServerApiClient } from './WhisperServerApiClient';
import { WhisperServerProcess } from './WhisperServerProcess';
import type { TranscriptionCallbacks } from './types';
import { normalizeChunk } from './utils';

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
    private readonly parseProgress: (value: string) => void;
    private hasRealtimeOutput = false;
    private readonly handleProcessExit = () => {
        this.stopServer();
    };
    private readonly handleServerExit = (code: number | null) => {
        this.callbacks.onStderrChunk?.(`whisper-server has terminated (code: ${code ?? 'unknown'})`);
        this.modelManager.reset();
    };

    constructor(callbacks: TranscriptionCallbacks) {
        this.callbacks = callbacks;
        this.parseProgress = createProgressParser(callbacks.onProgressPercent);
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

        try {
            const resolved = resolveWhisperPaths(opts.model);

            await this.loadModelIfNeeded({
                serverBinPath: resolved.serverBinPath,
                modelPath: resolved.modelPath,
                vadModelPath: resolved.vadModelPath,
                useGpu: opts.useGpu,
            });

            const { wavPath, cleanup } = await this.audioPreprocessor.prepareAudioFile(audioPath, opts.segment);

            this.abortController = new AbortController();
            this.hasRealtimeOutput = false;
            this.streamParser.reset();

            this.callbacks.onProgressPercent?.(0);

            try {
                const fileBuffer = await fs.readFile(wavPath);
                const safeBuffer = new Uint8Array(fileBuffer.byteLength);

                safeBuffer.set(fileBuffer);
                const inferenceResult = await this.apiClient.inference(
                    {
                        audioBuffer: safeBuffer,
                        fileName: path.basename(wavPath) || 'audio.wav',
                        options: opts,
                    },
                    this.abortController.signal,
                );

                this.abortController = null;

                if (!inferenceResult.ok) {
                    throw new Error(
                        `whisper-server вернул ${inferenceResult.status}: ${
                            inferenceResult.errorText || inferenceResult.statusText
                        }`,
                    );
                }

                const transcriptText = inferenceResult.text;

                if (!this.hasRealtimeOutput) {
                    this.callbacks.onStdoutChunk?.(transcriptText);
                }
                this.callbacks.onProgressPercent?.(100);

                return transcriptText;
            } catch (error) {
                if (this.abortController === null && error instanceof Error && error.name === 'AbortError') {
                    throw new Error('Распознавание остановлено пользователем');
                }

                throw error instanceof Error ? error : new Error(String(error));
            } finally {
                if (this.abortController) {
                    this.abortController = null;
                }
                await cleanup().catch(() => void 0);
            }
        } finally {
            this.isTranscribing = false;
        }
    }

    private get baseUrl(): string {
        return `http://${SERVER_HOST}:${SERVER_PORT}`;
    }

    private abortInference(): boolean {
        if (!this.abortController) return false;

        this.abortController.abort();
        this.abortController = null;

        return true;
    }

    private handleStdoutChunk(text: string) {
        const lines = this.streamParser.pushChunk(text);

        if (lines.length > 0) {
            this.hasRealtimeOutput = true;
        }

        for (const line of lines) {
            this.callbacks.onStdoutChunk?.(line);
        }
    }

    private createOutputHandler(source: 'stdout' | 'stderr') {
        return (chunk: unknown) => {
            const text = normalizeChunk(chunk);

            if (!text) return;

            if (source === 'stdout') {
                this.handleStdoutChunk(text);
            }
            this.callbacks.onStderrChunk?.(`[server:${source}] ${text}`);
            this.parseProgress(text);
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
            await this.startServer(paths);

            return;
        }

        await this.modelManager.loadModelIfNeeded(paths.modelPath);
    }
}
