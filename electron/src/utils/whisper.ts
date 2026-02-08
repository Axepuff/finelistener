import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import type { TranscribeOpts } from '../types/transcription';
import type { WhisperModelName } from '../types/whisper';

const IS_DEV = !app.isPackaged;
const WHISPER_DIR_NAME = 'whisper.cpp';
const WHISPER_SERVER_BIN_NAMES = process.platform === 'win32' ? ['whisper-server.exe', 'whisper-server'] : ['whisper-server'];
const VAD_MODEL_FILE = 'ggml-silero-v5.1.2.bin';
const MODEL_METADATA: Record<WhisperModelName, { fileName: string; sizeLabel: string; downloadUrl: string }> = {
    large: {
        fileName: 'ggml-large-v3-turbo-q8_0.bin',
        sizeLabel: '874 mb',
        downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q8_0.bin',
    },
    base: {
        fileName: 'ggml-base.bin',
        sizeLabel: '148 MB',
        downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
    },
    small: {
        fileName: 'ggml-small-q8_0.bin',
        sizeLabel: '264 MB',
        downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q8_0.bin',
    },
};

const resolveDefaultModelName = (): WhisperModelName => {
    const envValue = process.env.WHISPER_DEFAULT_MODEL;

    if (envValue && envValue in MODEL_METADATA) {
        return envValue as WhisperModelName;
    }

    return 'large';
};

export const DEFAULT_MODEL_NAME = resolveDefaultModelName();

export interface ResolvedWhisperPaths {
    baseDir: string;
    serverBinPath: string;
    modelPath: string;
    vadModelPath: string;
}

export const getWhisperModelNames = (): WhisperModelName[] => Object.keys(MODEL_METADATA) as WhisperModelName[];

export const getModelSizeLabel = (model: WhisperModelName): string => MODEL_METADATA[model].sizeLabel;

export const getModelDownloadUrl = (model: WhisperModelName): string => MODEL_METADATA[model].downloadUrl;

export const getModelFileName = (model: WhisperModelName): string => MODEL_METADATA[model].fileName;

const getBundledModelsCandidates = (): string[] => {
    if (IS_DEV) {
        return [path.resolve(app.getAppPath(), 'models')];
    }

    return [
        path.join(process.resourcesPath, 'models'),
        path.join(process.resourcesPath, 'app.asar.unpacked', 'models'),
    ];
};

export const getBundledModelsDir = (): string => getBundledModelsCandidates()[0];

export const getUserModelsDir = (): string => path.resolve(app.getPath('userData'), 'models');

export const isModelBundled = (model: WhisperModelName): boolean => {
    const fileName = getModelFileName(model);

    return getBundledModelsCandidates().some((baseDir) => fs.existsSync(path.join(baseDir, fileName)));
};

export const isModelAvailable = (model: WhisperModelName): boolean => {
    const fileName = getModelFileName(model);
    const userPath = path.join(getUserModelsDir(), fileName);
    const isBundledAvailable = getBundledModelsCandidates().some((baseDir) =>
        fs.existsSync(path.join(baseDir, fileName)),
    );

    return fs.existsSync(userPath) || isBundledAvailable;
};

export const resolveModelPath = (model: WhisperModelName): string => {
    const fileName = getModelFileName(model);
    const candidates = [path.join(getUserModelsDir(), fileName)];

    candidates.push(...getBundledModelsCandidates().map((baseDir) => path.join(baseDir, fileName)));

    return pickExistingPath(candidates, 'Whisper model file is missing');
};

/**
 * Ищем бинарники/модели whisper внутри ресурсов приложения.
 */
export function resolveWhisperPaths(
    model: WhisperModelName = DEFAULT_MODEL_NAME,
    modelPathOverride?: string,
): ResolvedWhisperPaths {
    const appPath = app.getAppPath();
    const baseCandidates = IS_DEV
        ? [
            path.resolve(appPath, WHISPER_DIR_NAME),
        ]
        : [
            path.join(process.resourcesPath, WHISPER_DIR_NAME),
            path.resolve(appPath, WHISPER_DIR_NAME),
        ];

    const base = pickExistingPath(baseCandidates, 'Cannot locate whisper.cpp assets');
    const serverBinPath = pickExistingPath(
        [
            ...WHISPER_SERVER_BIN_NAMES.map((name) => path.join(base, 'build', 'bin', name)),
            ...WHISPER_SERVER_BIN_NAMES.map((name) => path.join(base, 'bin', name)),
        ],
        'whisper-server binary is missing. Did you run the native build?',
    );
    const modelPath = modelPathOverride
        ? resolveUserModelOverridePath(modelPathOverride)
        : resolveModelPath(model);
    const vadModelPath = pickExistingPath(
        getBundledModelsCandidates().map((baseDir) => path.join(baseDir, VAD_MODEL_FILE)),
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

function resolveUserModelOverridePath(modelPathOverride: string): string {
    const resolved = path.resolve(modelPathOverride);
    const userModelsDir = getUserModelsDir();

    if (!isPathInsideDir(resolved, userModelsDir)) {
        throw new Error('Custom model path must be inside user models directory');
    }

    return pickExistingPath([resolved], 'Custom Whisper model file is missing');
}

function isPathInsideDir(candidatePath: string, baseDir: string): boolean {
    const relative = path.relative(baseDir, candidatePath);

    return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}
