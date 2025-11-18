import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import * as path from 'path';
import type { TranscribeOpts } from '../controllers/transcriptionController';
import { buildTranscribeArgs, resolveWhisperPaths } from '../utils/whisper';

type Callbacks = {
    onStdoutChunk?: (chunk: string) => void;
    onStderrChunk?: (chunk: string) => void;
    onProgressPercent?: (value: number) => void;
};

export function createTranscriptionService(callbacks: Callbacks) {
    let child: ChildProcessWithoutNullStreams | null = null;

    function stop(): boolean {
        if (!child) return false;
        try {
            child.kill('SIGINT');
        } catch {
            // ignore
        } finally {
            child = null;
        }

        return true;
    }

    async function transcribe(audioPath: string, opts: TranscribeOpts): Promise<string> {
        const { binPath, modelPath, vadModelPath } = resolveWhisperPaths();

        const args = buildTranscribeArgs(audioPath, opts, { modelPath, vadModelPath });

        const env: NodeJS.ProcessEnv = { ...process.env };

        if (process.platform === 'darwin') {
            // cspell:ignore DYLD
            env.DYLD_LIBRARY_PATH = env.DYLD_LIBRARY_PATH || path.dirname(binPath);
        } else if (process.platform === 'linux') {
            const p = path.dirname(binPath);

            env.LD_LIBRARY_PATH = [p, process.env.LD_LIBRARY_PATH]
                .filter(Boolean)
                .join(path.delimiter);
        }

        return new Promise<string>((resolve, reject) => {
            let full = '';
            let progressBuffer = '';
            let lastProgressReported = -1;

            child = spawn(binPath, args, { env });

            child.stdout.setEncoding('utf8');
            child.stdout.on('data', (chunk: unknown) => {
                if (typeof chunk === 'string') {
                    full += chunk;
                    callbacks.onStdoutChunk?.(chunk);
                }
            });

            child.stderr.setEncoding('utf8');
            child.stderr.on('data', (chunk: unknown) => {
                if (typeof chunk === 'string') {
                    callbacks.onStderrChunk?.(chunk);

                    progressBuffer += chunk;

                    const regex = /progress\s*=\s*(\d+)%/gi;
                    let match: RegExpExecArray | null;
                    let lastConsumedIdx = 0;

                    while ((match = regex.exec(progressBuffer)) !== null) {
                        lastConsumedIdx = Math.max(lastConsumedIdx, match.index + match[0].length);

                        const progressValue = Number.parseInt(match[1], 10);

                        if (!Number.isNaN(progressValue) && progressValue !== lastProgressReported) {
                            lastProgressReported = progressValue;
                            callbacks.onProgressPercent?.(progressValue);
                        }
                    }

                    if (lastConsumedIdx > 0) {
                        progressBuffer = progressBuffer.slice(lastConsumedIdx);
                    } else if (progressBuffer.length > 256) {
                        progressBuffer = progressBuffer.slice(-64);
                    }
                }
            });

            child.on('error', (err) => reject(err));
            child.on('close', (code) => {
                const exitCode = typeof code === 'number' ? code : -1;

                if (exitCode === 0) resolve(full);
                else reject(new Error(`whisper exited with code ${exitCode}`));
            });
        });
    }

    process.on('beforeExit', () => stop());
    process.on('exit', () => stop());

    return { transcribe, stop };
}
