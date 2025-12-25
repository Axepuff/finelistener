import type { TranscribeOpts } from '../controllers/transcriptionController';
import { Whisper } from '../services/whisperServer/Whisper';
import { resolveWhisperPaths } from '../utils/whisper';
import type { TranscriptionCallbacks } from './whisperServer/types';

export class TranscriptionService {
    private readonly serverRunner: Whisper;
    private readonly callbacks: TranscriptionCallbacks;
    private readonly handleProcessExit = () => {
        this.stop();
    };

    constructor(callbacks: TranscriptionCallbacks) {
        this.callbacks = callbacks;
        this.serverRunner = new Whisper(callbacks);
        this.init().catch(() => void 0);
    }

    public async transcribe(audioPath: string, opts: TranscribeOpts): Promise<string> {
        try {
            return await this.serverRunner.transcribe(audioPath, opts);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            this.callbacks.onStderrChunk?.(
                `Failed to process request via whisper-server: ${message}.`,
            );

            throw error;
        }
    }

    public stop(): boolean {
        const stoppedServer = this.serverRunner.stop();

        return stoppedServer;
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
