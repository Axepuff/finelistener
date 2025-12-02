import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import ffmpegPath from 'ffmpeg-static';
import type { TranscribeOpts } from '../controllers/transcriptionController';
import { buildTranscribeArgs, resolveWhisperPaths } from '../utils/whisper';

type Callbacks = {
    onStdoutChunk?: (chunk: string) => void;
    onStderrChunk?: (chunk: string) => void;
    onProgressPercent?: (value: number) => void;
};

const handleProgress = (chunk: string, onProgressPercent?: (value: number) => void) => {
    let progressBuffer = '';
    let lastProgressReported = -1;

    progressBuffer += chunk;

    const regex = /progress\s*=\s*(\d+)%/gi;
    let match: RegExpExecArray | null;
    let lastConsumedIdx = 0;

    while ((match = regex.exec(progressBuffer)) !== null) {
        lastConsumedIdx = Math.max(lastConsumedIdx, match.index + match[0].length);

        const progressValue = Number.parseInt(match[1], 10);

        if (!Number.isNaN(progressValue) && progressValue !== lastProgressReported) {
            lastProgressReported = progressValue;
            onProgressPercent?.(progressValue);
        }
    }

    if (lastConsumedIdx > 0) {
        progressBuffer = progressBuffer.slice(lastConsumedIdx);
    } else if (progressBuffer.length > 256) {
        progressBuffer = progressBuffer.slice(-64);
    }
};

const resolveFfmpegExecutable = () => {
    if (!ffmpegPath) {
        throw new Error('ffmpeg-static binary path is empty');
    }

    return ffmpegPath.replace('app.asar', 'app.asar.unpacked');
};

const trimAudioIfNeeded = async (
    audioPath: string,
    segment?: TranscribeOpts['segment'],
): Promise<{ path: string; cleanup?: () => Promise<void> }> => {
    if (!segment) return { path: audioPath };

    const { start, end } = segment;

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return { path: audioPath };
    }

    const tmpDir = await fs.mkdtemp(path.join(tmpdir(), 'finelistener-'));
    const sourceExt = path.extname(audioPath) || '.wav';
    const trimmedPath = path.join(tmpDir, `${randomUUID()}${sourceExt}`);
    const duration = end - start;
    const ffmpegExecutable = resolveFfmpegExecutable();

    try {
        await new Promise<void>((resolve, reject) => {
            const ffmpeg = spawn(
                ffmpegExecutable,
                ['-y', '-ss', String(start), '-t', String(duration), '-i', audioPath, '-acodec', 'copy', '-vn', trimmedPath],
                { windowsHide: true },
            );
            let stderr = '';

            ffmpeg.stderr?.on('data', (chunk: unknown) => {
                const data = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : '';

                stderr += data;
            });

            ffmpeg.on('error', reject);
            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`ffmpeg exited with code ${code}${stderr ? `: ${stderr}` : ''}`));
                }
            });
        });
    } catch (err: unknown) {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => void 0);
        const message = err instanceof Error ? err.message : String(err);

        throw new Error(`Не удалось подготовить фрагмент аудио: ${message}`);
    }

    const cleanup = async () => {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => void 0);
    };

    return { path: trimmedPath, cleanup };
};

const convertAudioToWav = async (audioPath: string): Promise<{ path: string; cleanup: () => Promise<void> }> => {
    const ffmpegExecutable = resolveFfmpegExecutable();
    const tmpDir = await fs.mkdtemp(path.join(tmpdir(), 'finelistener-'));
    const wavPath = path.join(tmpDir, `${randomUUID()}.wav`);

    try {
        await new Promise<void>((resolve, reject) => {
            const ffmpeg = spawn(
                ffmpegExecutable,
                ['-y', '-i', audioPath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavPath],
                { windowsHide: true },
            );
            let stderr = '';

            ffmpeg.stderr?.on('data', (chunk: unknown) => {
                const data = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : '';

                stderr += data;
            });

            ffmpeg.on('error', reject);
            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`ffmpeg exited with code ${code}${stderr ? `: ${stderr}` : ''}`));
                }
            });
        });
    } catch (error) {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => void 0);
        const message = error instanceof Error ? error.message : String(error);

        throw new Error(`Не удалось конвертировать аудио в WAV: ${message}`);
    }

    const cleanup = async () => {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => void 0);
    };

    return { path: wavPath, cleanup };
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
        const { binPath, modelPath, vadModelPath } = resolveWhisperPaths(opts.model);

        const { path: trimmedPath, cleanup: trimCleanup } = await trimAudioIfNeeded(audioPath, opts.segment);
        const { path: wavPath, cleanup: convertCleanup } = await convertAudioToWav(trimmedPath).catch(async (err) => {
            if (trimCleanup) {
                await trimCleanup().catch(() => void 0);
            }
            throw err;
        });
        const args = buildTranscribeArgs(wavPath, opts, { modelPath, vadModelPath });

        callbacks.onStderrChunk?.('\nARGS:' + args.map(a => a).join(','));

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

        try {
            return await new Promise<string>((resolve, reject) => {
                let full = '';
                let stderrFull = '';

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

                        stderrFull += chunk;
                        if (stderrFull.length > 8000) {
                            stderrFull = stderrFull.slice(-4000);
                        }

                        handleProgress(chunk, callbacks.onProgressPercent);
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
            if (convertCleanup) {
                await convertCleanup().catch(() => void 0);
            }
            if (trimCleanup) {
                await trimCleanup().catch(() => void 0);
            }
        }
    }

    process.on('beforeExit', () => stop());
    process.on('exit', () => stop());

    return { transcribe, stop };
}
