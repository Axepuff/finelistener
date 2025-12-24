import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import type { TranscribeOpts } from '../controllers/transcriptionController';

const IS_DEV = !app.isPackaged;
const WHISPER_DIR_NAME = 'whisper.cpp';
// const WHISPER_CLI_BIN_NAMES = process.platform === 'win32' ? ['whisper-cli.exe', 'whisper-cli'] : ['whisper-cli'];
const WHISPER_SERVER_BIN_NAMES = process.platform === 'win32' ? ['whisper-server.exe', 'whisper-server'] : ['whisper-server'];
const VAD_MODEL_FILE = 'ggml-silero-v5.1.2.bin';
const MODEL_FILES = {
    // large_v3_turbo: 'ggml-large-v3-turbo.bin',
    large_v3_turbo: 'ggml-large-v3-q5_0.bin',
    small: 'ggml-small-q8_0.bin',
    base_q: 'ggml-base-q8_0.bin',
    base: 'ggml-base.bin',
    tiny: 'ggml-tiny-q8_0.bin',
} as const;

export type WhisperModelName = keyof typeof MODEL_FILES;

export interface ResolvedWhisperPaths {
    baseDir: string;
    serverBinPath: string;
    modelPath: string;
    vadModelPath: string;
}

/**
 * Ищем бинарники/модели whisper внутри ресурсов приложения.
 */
export function resolveWhisperPaths(model: WhisperModelName = 'base'): ResolvedWhisperPaths {
    const appPath = app.getAppPath();
    const baseCandidates = IS_DEV
        ? [
            path.resolve(appPath, WHISPER_DIR_NAME),
        ]
        : [
            path.join(process.resourcesPath, WHISPER_DIR_NAME),
            path.resolve(appPath, WHISPER_DIR_NAME),
        ];

    const modelsPath = path.resolve(appPath, 'models');

    const base = pickExistingPath(baseCandidates, 'Cannot locate whisper.cpp assets');
    const serverBinPath = pickExistingPath(
        [
            ...WHISPER_SERVER_BIN_NAMES.map((name) => path.join(base, 'build', 'bin', name)),
            ...WHISPER_SERVER_BIN_NAMES.map((name) => path.join(base, 'bin', name)),
        ],
        'whisper-server binary is missing. Did you run the native build?',
    );
    const modelPath = pickExistingPath(
        [path.join(modelsPath, MODEL_FILES[model])],
        'Whisper model file is missing',
    );
    const vadModelPath = pickExistingPath(
        [path.join(modelsPath, VAD_MODEL_FILE)],
        'VAD model file is missing',
    );

    return { baseDir: base, serverBinPath, modelPath, vadModelPath };
}

export function buildTranscribeArgs(
    audioPath: string,
    opts: TranscribeOpts,
    modelPaths: Pick<ResolvedWhisperPaths, 'modelPath' | 'vadModelPath'>,
): string[] {
    const args: string[] = ['-m', modelPaths.modelPath, '-f', audioPath, '--print-progress'];

    if (opts.language) args.push('-l', opts.language);
    if (typeof opts.maxContext === 'number') args.push('--max-context', String(opts.maxContext));
    if (typeof opts.maxLen === 'number' && opts.maxLen > 0) args.push('--max-len', String(opts.maxLen));
    if (opts.splitOnWord) args.push('--split-on-word');
    if (opts.useVad) args.push('--vad', '--vad-model', opts.vadModelPath || modelPaths.vadModelPath);

    return args;
}

/**
 * Собираем переменные окружения, чтобы whisper видел динамические библиотеки рядом с бинарником.
 */
export const createWhisperEnv = (binPath: string): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    const libDir = path.dirname(binPath);

    if (process.platform === 'darwin') {
        // cspell:ignore DYLD
        env.DYLD_LIBRARY_PATH = env.DYLD_LIBRARY_PATH || libDir;
    } else if (process.platform === 'linux') {
        env.LD_LIBRARY_PATH = [libDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(path.delimiter);
    }

    return env;
};

function pickExistingPath(candidates: string[], errorMessage: string): string {
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }

    throw new Error(`${errorMessage}: ${candidates.join(', ')}`);
}
