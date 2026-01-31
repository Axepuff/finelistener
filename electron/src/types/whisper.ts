export const WHISPER_MODEL_NAMES = ['large', 'base', 'small'] as const;

export type WhisperModelName = (typeof WHISPER_MODEL_NAMES)[number];

export interface WhisperModelInfo {
    name: WhisperModelName;
    sizeLabel: string;
    isDownloaded: boolean;
    isBundled: boolean;
}

export interface WhisperModelDownloadProgress {
    name: WhisperModelName;
    percent: number | null;
    downloadedBytes: number;
    totalBytes: number | null;
}

export const isWhisperModelName = (value: unknown): value is WhisperModelName =>
    typeof value === 'string' && (WHISPER_MODEL_NAMES as readonly string[]).includes(value);
