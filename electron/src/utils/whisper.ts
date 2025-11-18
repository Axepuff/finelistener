import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import type { TranscribeOpts } from '../controllers/transcriptionController';

const IS_DEV = !app.isPackaged;

export function resolveWhisperPaths() {
    const appPath = app.getAppPath();

    const baseCandidates = IS_DEV
        ? [
            path.resolve(appPath, 'whisper.cpp'),
            path.resolve(appPath, '../whisper.cpp'),
            path.resolve(__dirname, '../../../../whisper.cpp'),
        ]
        : [
            path.join(process.resourcesPath, 'whisper.cpp'),
            path.resolve(appPath, '../whisper.cpp'),
        ];

    const base = pickExistingPath(baseCandidates, 'Cannot locate whisper.cpp assets');
    const binPath = pickExistingPath(
        [
            path.join(base, 'build', 'bin', 'whisper-cli'),
            path.join(base, 'bin', 'whisper-cli'),
        ],
        'whisper-cli binary is missing. Did you run the native build?',
    );
    const modelPath = pickExistingPath(
        [path.join(base, 'models', 'ggml-large-v3-q5_0.bin')],
        'Whisper model file is missing',
    );
    const vadModelPath = pickExistingPath(
        [path.join(base, 'models', 'ggml-silero-v5.1.2.bin')],
        'VAD model file is missing',
    );

    return { binPath, modelPath, vadModelPath };
}

export function buildTranscribeArgs(
    audioPath: string,
    opts: TranscribeOpts,
    modelPaths: { modelPath: string; vadModelPath: string },
): string[] {
    const args: string[] = ['-m', modelPaths.modelPath, '-f', audioPath, '-otxt', '--print-progress'];

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
