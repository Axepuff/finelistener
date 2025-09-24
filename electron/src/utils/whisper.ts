import path from 'path';
import { app } from 'electron';
import type { TranscribeOpts } from '../controllers/transcriptionController';

const IS_DEV = !app.isPackaged;

export function resolveWhisperPaths() {
    const base = IS_DEV
        ? path.resolve(__dirname, '../../../whisper.cpp')
        : path.join(process.resourcesPath, 'whisper.cpp');
    const binPath = path.join(base, 'build', 'bin', 'whisper-cli');
    const modelPath = path.join(base, 'models', 'ggml-large-v3-q5_0.bin');
    const vadModelPath = path.join(base, 'models', 'ggml-silero-v5.1.2.bin');

    return { binPath, modelPath, vadModelPath };
}

export function buildTranscribeArgs(
    audioPath: string,
    opts: TranscribeOpts,
    modelPaths: { modelPath: string; vadModelPath: string }
): string[] {
    const args: string[] = ['-m', modelPaths.modelPath, '-f', audioPath, '-otxt'];

    if (opts.language) args.push('-l', opts.language);
    if (typeof opts.maxContext === 'number') args.push('--max-context', String(opts.maxContext));
    if (typeof opts.maxLen === 'number' && opts.maxLen > 0) args.push('--max-len', String(opts.maxLen));
    if (opts.splitOnWord) args.push('--split-on-word');
    if (opts.useVad) args.push('--vad', '--vad-model', opts.vadModelPath || modelPaths.vadModelPath);

    return args;
}
