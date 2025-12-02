import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import type { TranscribeOpts } from '../controllers/transcriptionController';

const IS_DEV = !app.isPackaged;
const WHISPER_DIR_NAME = 'whisper.cpp';
const WHISPER_BIN_NAMES = process.platform === 'win32' ? ['whisper-cli.exe', 'whisper-cli'] : ['whisper-cli'];
const VAD_MODEL_FILE = 'ggml-silero-v5.1.2.bin';
const MODEL_FILES = {
    large_v3_turbo: 'ggml-large-v3-turbo.bin',
    small: 'ggml-small-q8_0.bin',
    base_q: 'ggml-base-q8_0.bin',
    base: 'ggml-base.bin',
    tiny: 'ggml-tiny-q8_0.bin',
} as const;

export type WhisperModelName = keyof typeof MODEL_FILES;

export function resolveWhisperPaths(model: WhisperModelName = 'base') {
    const appPath = app.getAppPath();
    const baseCandidates = IS_DEV
        ? [path.resolve(appPath, '..', WHISPER_DIR_NAME), path.resolve(appPath, WHISPER_DIR_NAME)]
        : [path.join(process.resourcesPath, WHISPER_DIR_NAME), path.resolve(appPath, '..', WHISPER_DIR_NAME)];

    const base = pickExistingPath(baseCandidates, 'Cannot locate whisper.cpp assets');
    const binPath = pickExistingPath(
        [
            ...WHISPER_BIN_NAMES.map((name) => path.join(base, 'build', 'bin', name)),
            ...WHISPER_BIN_NAMES.map((name) => path.join(base, 'bin', name)),
        ],
        'whisper-cli binary is missing. Did you run the native build?',
    );
    const modelPath = pickExistingPath(
        [path.join(base, 'models', MODEL_FILES[model])],
        'Whisper model file is missing',
    );
    const vadModelPath = pickExistingPath(
        [path.join(base, 'models', VAD_MODEL_FILE)],
        'VAD model file is missing',
    );

    return { binPath, modelPath, vadModelPath };
}

export function buildTranscribeArgs(
    audioPath: string,
    opts: TranscribeOpts,
    modelPaths: { modelPath: string; vadModelPath: string },
): string[] {
    const args: string[] = ['-m', modelPaths.modelPath, '-f', audioPath, '--print-progress'];

    if (opts.language) args.push('-l', opts.language);
    if (typeof opts.maxContext === 'number') args.push('--max-context', String(opts.maxContext));
    if (typeof opts.maxLen === 'number' && opts.maxLen > 0) args.push('--max-len', String(opts.maxLen));
    if (opts.splitOnWord) args.push('--split-on-word');
    if (opts.useVad) args.push('--vad', '--vad-model', opts.vadModelPath || modelPaths.vadModelPath);

    return args;
}

function pickExistingPath(candidates: string[], errorMessage: string): string {
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }

    throw new Error(`${errorMessage}: ${candidates.join(', ')}`);
}
