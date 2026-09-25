import { Whisper } from '../services/whisperServer/Whisper';
import type { SessionTranscribeOpts, TranscribeOpts } from '../types/transcription';
import type { SessionDetails } from '../types/sessions';
import { resolveWhisperPaths } from '../utils/whisper';
import type { TranscriptionCallbacks } from './whisperServer/types';
import type { SessionsService } from './SessionsService';
import { transcribeSessionSources, type SourcePass } from './SessionTranscriptionRunner';

export class TranscriptionService {
    private readonly serverRunner: Whisper;
    private readonly callbacks: TranscriptionCallbacks;
    private activeOperation: AbortController | null = null;
    private sourcePass: SourcePass | null = null;
    private operationFinished: Promise<void> = Promise.resolve();
    private finishOperation: (() => void) | null = null;
    private readonly handleProcessExit = () => {
        this.stop();
    };

    constructor(callbacks: TranscriptionCallbacks) {
        this.callbacks = callbacks;
        this.serverRunner = new Whisper({
            ...callbacks,
            onStdoutChunk: (event) => {
                if (this.activeOperation?.signal.aborted) return;
                callbacks.onStdoutChunk?.(this.sourcePass ? {
                    ...event, source: this.sourcePass.source, offsetSec: this.sourcePass.offsetSec,
                } : event);
            },
            onProgressPercent: (event) => {
                if (this.activeOperation?.signal.aborted) return;
                const pass = this.sourcePass;
                callbacks.onProgressPercent?.(pass ? {
                    ...event, source: pass.source, value: (pass.index * 100 + event.value) / pass.count,
                } : event);
            },
        });
        this.init().catch((error: unknown) => {
            callbacks.onStderrChunk?.(`Failed to initialize transcription server: ${String(error)}`);
        });
    }

    public async transcribe(audioPath: string, opts: TranscribeOpts): Promise<string> {
        if (this.activeOperation) throw new Error('Previous transcription is not finished yet');
        this.activeOperation = new AbortController();
        this.operationFinished = new Promise((resolve) => { this.finishOperation = resolve; });
        try {
            const text = await this.serverRunner.transcribe(audioPath, opts);
            this.activeOperation.signal.throwIfAborted();
            return text;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            this.callbacks.onStderrChunk?.(
                `Failed to process request via whisper-server: ${message}.`,
            );

            throw error;
        } finally {
            this.activeOperation = null;
            this.finishOperation?.();
            this.finishOperation = null;
        }
    }

    public async transcribeSession(
        sessionId: string, opts: SessionTranscribeOpts, sessions: SessionsService,
    ): Promise<SessionDetails> {
        if (this.activeOperation) throw new Error('Previous transcription is not finished yet');
        const operation = new AbortController();
        this.activeOperation = operation;
        this.operationFinished = new Promise((resolve) => { this.finishOperation = resolve; });
        try {
            return await transcribeSessionSources(sessionId, opts, sessions, async (audioPath, options, pass) => {
                operation.signal.throwIfAborted();
                this.sourcePass = pass;
                try {
                    return await this.serverRunner.transcribe(audioPath, options);
                } catch (error) {
                    if (!operation.signal.aborted) {
                        const message = error instanceof Error ? error.message : String(error);
                        this.callbacks.onStderrChunk?.(`Failed to transcribe ${pass.source}: ${message}`);
                    }
                    throw error;
                }
            }, operation.signal);
        } finally {
            this.sourcePass = null;
            this.activeOperation = null;
            this.finishOperation?.();
            this.finishOperation = null;
        }
    }

    public async stopAndWait(): Promise<boolean> {
        const finished = this.operationFinished;
        const stopped = this.stop();
        await finished;
        return stopped;
    }

    public stop(): boolean {
        const hadOperation = this.activeOperation !== null;
        this.activeOperation?.abort();
        const stoppedServer = this.serverRunner.stop();

        return stoppedServer || hadOperation;
    }

    private async init() {
        const { serverBinPath, modelPath, vadModelPath } = resolveWhisperPaths();

        await this.serverRunner.startServer({
            serverBinPath: serverBinPath,
            modelPath: modelPath,
            vadModelPath: vadModelPath,
        });

        process.on('beforeExit', this.handleProcessExit);
        process.on('exit', this.handleProcessExit);
    }
}
