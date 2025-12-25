import fs from 'fs/promises';
import path from 'path';
import type { TranscribeOpts } from '../../controllers/transcriptionController';
import { createWhisperEnv, resolveWhisperPaths } from '../../utils/whisper';
import { prepareAudioFile } from '../audioProcessing';
import { createProgressParser } from '../progress';
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

export class WhisperServerRunner {
    private readonly apiClient: WhisperServerApiClient;
    private readonly modelManager: WhisperModelManager;
    private readonly serverProcess: WhisperServerProcess;
    private abortController: AbortController | null = null;
    private readonly callbacks: TranscriptionCallbacks;
    private readonly parseProgress: (value: string) => void;
    private stdoutBuffer = '';
    private hasRealtimeOutput = false;
    private readonly transcriptLineRegex =
        /^\[\d{2}:\d{2}:\d{2}\.\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}\.\d{3}\]\s+/;
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
        this.serverProcess = new WhisperServerProcess({
            onStdoutData: this.createOutputHandler('stdout'),
            onStderrData: this.createOutputHandler('stderr'),
            onExit: this.handleServerExit,
        });
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
        if (this.abortController) {
            throw new Error('Previous transcription is not finished yet');
        }

        const resolved = resolveWhisperPaths(opts.model);

        await this.loadModelIfNeeded({
            serverBinPath: resolved.serverBinPath,
            modelPath: resolved.modelPath,
            vadModelPath: resolved.vadModelPath,
            useGpu: opts.useGpu,
        });

        const { wavPath, cleanup } = await prepareAudioFile(audioPath, opts.segment);

        this.abortController = new AbortController();
        this.hasRealtimeOutput = false;
        this.stdoutBuffer = '';

        this.callbacks.onProgressPercent?.(0);

        try {
            const fileBuffer = await fs.readFile(wavPath);
            const safeBuffer = new Uint8Array(fileBuffer.byteLength);

            safeBuffer.set(fileBuffer);
            const inferenceResult = await this.apiClient.inference(
                {
                    audioBuffer: safeBuffer,
                    fileName: path.basename(audioPath) || 'audio.wav',
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
        // Buffer stdout to avoid losing lines when chunks split mid-line.
        this.stdoutBuffer += text;

        const lines = this.stdoutBuffer.split('\n');

        // Keep the last partial line in the buffer for the next chunk.
        this.stdoutBuffer = lines.pop() ?? '';

        for (const line of lines) {
            const cleanedLine = line.replace(/\r$/, '');

            // Whisper realtime output uses timestamped lines; ignore other log noise.
            if (!this.transcriptLineRegex.test(cleanedLine)) continue;

            this.hasRealtimeOutput = true;
            this.callbacks.onStdoutChunk?.(`${cleanedLine}\n`);
        }

        // Prevent unbounded growth if server spams non-newline output.
        if (this.stdoutBuffer.length > 10_000) {
            this.stdoutBuffer = this.stdoutBuffer.slice(-2000);
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
