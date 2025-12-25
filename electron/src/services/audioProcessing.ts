import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import ffmpegPath from 'ffmpeg-static';
import type { TranscribeOpts } from '../controllers/transcriptionController';

const resolveFfmpegExecutable = () => {
    if (!ffmpegPath) {
        throw new Error('ffmpeg-static binary path is empty');
    }

    return ffmpegPath.replace('app.asar', 'app.asar.unpacked');
};

const removeDirSafe = async (dir: string | undefined) => {
    if (!dir) return;

    await fs.rm(dir, { recursive: true, force: true }).catch(() => void 0);
};

/**
 * Обрезаем аудиофайл, если указан диапазон. Возвращаем путь до временного файла.
 */
export const trimAudioIfNeeded = async (
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
        await removeDirSafe(tmpDir);
        const message = err instanceof Error ? err.message : String(err);

        throw new Error(`Не удалось подготовить фрагмент аудио: ${message}`);
    }

    const cleanup = async () => {
        await removeDirSafe(tmpDir);
    };

    return { path: trimmedPath, cleanup };
};

/**
 * Конвертируем любое поддерживаемое аудио в WAV 16k mono, как требует whisper.cpp.
 */
export const convertAudioToWav = async (
    audioPath: string,
): Promise<{ path: string; cleanup: () => Promise<void> }> => {
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
        await removeDirSafe(tmpDir);
        const message = error instanceof Error ? error.message : String(error);

        throw new Error(`Не удалось конвертировать аудио в WAV: ${message}`);
    }

    const cleanup = async () => {
        await removeDirSafe(tmpDir);
    };

    return { path: wavPath, cleanup };
};

/**
 * Готовим вход для whisper: обрезаем нужный диапазон и конвертируем в WAV.
 */
export const prepareAudioFile = async (
    audioPath: string,
    segment?: TranscribeOpts['segment'],
): Promise<{ wavPath: string; cleanup: () => Promise<void> }> => {
    const { path: trimmedPath, cleanup: trimCleanup } = await trimAudioIfNeeded(audioPath, segment);
    const { path: wavPath, cleanup: wavCleanup } = await convertAudioToWav(trimmedPath).catch(async (err) => {
        if (trimCleanup) {
            await trimCleanup().catch(() => void 0);
        }
        throw err;
    });

    const cleanup = async () => {
        await wavCleanup().catch(() => void 0);
        if (trimCleanup) {
            await trimCleanup().catch(() => void 0);
        }
    };

    return { wavPath, cleanup };
};
