import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import type { TranscribeOpts } from '../controllers/transcriptionController';
import { buildTranscribeArgs, createWhisperEnv, resolveWhisperPaths } from '../utils/whisper';
import { prepareAudioFile } from './audioProcessing';
import { createProgressParser } from './progress';
import type { TranscriptionCallbacks } from './whisperServer/types';

/**
 * Обёртка над whisper-cli. Сохраняем её как запасной путь на случай проблем с сервером.
 */
export const createWhisperCliRunner = (callbacks: TranscriptionCallbacks) => {
    let child: ChildProcessWithoutNullStreams | null = null;
    const parseProgress = createProgressParser(callbacks.onProgressPercent);

    const stop = (): boolean => {
        if (!child) return false;
        try {
            child.kill('SIGINT');
        } catch {
            // ignore
        } finally {
            child = null;
        }

        return true;
    };

    const transcribe = async (audioPath: string, opts: TranscribeOpts): Promise<string> => {
        const { modelPath, vadModelPath } = resolveWhisperPaths(opts.model);
        const cliBinPath = '';
        const { wavPath, cleanup } = await prepareAudioFile(audioPath, opts.segment);
        const args = buildTranscribeArgs(wavPath, opts, { modelPath, vadModelPath });
        const env = createWhisperEnv(cliBinPath);

        callbacks.onStderrChunk?.(`\nЗапускаю whisper-cli с аргументами: ${args.join(' ')}`);

        try {
            return await new Promise<string>((resolve, reject) => {
                let full = '';
                let stderrFull = '';

                child = spawn(cliBinPath, args, { env });

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

                        stderrFull += chunk;
                        if (stderrFull.length > 8000) {
                            stderrFull = stderrFull.slice(-4000);
                        }

                        parseProgress(chunk);
                    }
                });

                child.on('error', (err) => {
                    child = null;
                    reject(err);
                });
                child.on('close', (code) => {
                    child = null;
                    const exitCode = typeof code === 'number' ? code : -1;
                    const stderrDetails = stderrFull.trim();

                    if (exitCode === 0) resolve(full);
                    else {
                        const details = stderrDetails ? ` Details:\n${stderrDetails}` : '';

                        reject(new Error(`whisper exited with code ${exitCode}.${details}`));
                    }
                });
            });
        } finally {
            await cleanup().catch(() => void 0);
        }
    };

    return { transcribe, stop };
};
