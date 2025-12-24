type WhisperVerboseSegment = {
    id?: number;
    text?: string;
    start?: number;
    end?: number;
};

export type WhisperVerboseResponse = {
    text?: string;
    segments?: WhisperVerboseSegment[];
    error?: string;
};

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const normalizeChunk = (chunk: unknown): string => {
    if (typeof chunk === 'string') return chunk;
    if (Buffer.isBuffer(chunk)) return chunk.toString('utf8');

    return '';
};

export const fetchWithTimeout = async (url: string, init: RequestInit = {}, timeoutMs = 5000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
};

export const formatTimestamp = (seconds: number | undefined) => {
    if (!Number.isFinite(seconds ?? NaN)) return '00:00:00.000';

    const totalMs = Math.round((seconds as number) * 1000);
    const hours = Math.floor(totalMs / 3_600_000);
    const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
    const secs = Math.floor((totalMs % 60_000) / 1000);
    const ms = totalMs % 1000;

    const hh = String(hours).padStart(2, '0');
    const mm = String(minutes).padStart(2, '0');
    const ss = String(secs).padStart(2, '0');
    const mmm = String(ms).padStart(3, '0');

    return `${hh}:${mm}:${ss}.${mmm}`;
};

export const formatVerboseJson = (payload: WhisperVerboseResponse): string => {
    if (payload.error) {
        throw new Error(payload.error);
    }

    if (Array.isArray(payload.segments) && payload.segments.length > 0) {
        return payload.segments
            .map((segment) => {
                const start = formatTimestamp(segment.start);
                const end = formatTimestamp(segment.end);
                const text = segment.text?.trim() ?? '';

                return `[${start} --> ${end}] ${text}`;
            })
            .join('\n');
    }

    if (typeof payload.text === 'string') {
        return payload.text;
    }

    return '';
};
