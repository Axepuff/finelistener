import type { SessionTranscriptSegmentV1, SessionRecognitionWord } from '../../types/sessions';

type WhisperVerboseWord = {
    text?: string;
    word?: string;
    start?: number;
    end?: number;
};

type WhisperVerboseSegment = {
    id?: number;
    text?: string;
    start?: number;
    end?: number;
    words?: WhisperVerboseWord[];
};

export type WhisperVerboseResponse = {
    text?: string;
    segments?: WhisperVerboseSegment[];
    error?: string;
};

export interface StructuredTranscriptionResult {
    text: string;
    segments?: SessionTranscriptSegmentV1[];
}

const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

const completeWords = (segment: WhisperVerboseSegment): SessionRecognitionWord[] | undefined => {
    if (!Array.isArray(segment.words) || !segment.words.length || typeof segment.text !== 'string') return undefined;
    const pieces: Array<{ startChar: number; endChar: number; startSec?: number; endSec?: number }> = [];
    let cursor = 0;

    for (const item of segment.words) {
        const piece = item.text ?? item.word;
        if (typeof piece !== 'string' || !piece.length || segment.text.slice(cursor, cursor + piece.length) !== piece) {
            return undefined;
        }
        const timed = Number.isFinite(item.start) && Number.isFinite(item.end)
            && (item.start as number) >= 0 && (item.end as number) > (item.start as number);
        pieces.push({ startChar: cursor, endChar: cursor + piece.length,
            ...(timed ? { startSec: item.start, endSec: item.end } : {}) });
        cursor += piece.length;
    }
    if (cursor !== segment.text.length) return undefined;

    return [...segment.text.matchAll(WORD_PATTERN)].flatMap((match) => {
        const startChar = match.index ?? 0;
        const endChar = startChar + match[0].length;
        const contributing = pieces.filter((piece) => piece.startChar < endChar && piece.endChar > startChar);
        if (!contributing.length || contributing.some((piece) => piece.startSec === undefined
            || piece.endSec === undefined)) return [];
        const startSec = Math.min(...contributing.map((piece) => piece.startSec!));
        const endSec = Math.max(...contributing.map((piece) => piece.endSec!));
        if (Number.isFinite(segment.start) && startSec < (segment.start as number) - 0.05) return [];
        if (Number.isFinite(segment.end) && endSec > (segment.end as number) + 0.05) return [];
        return [{ startSec, endSec, text: match[0], startChar, endChar }];
    });
};

export const parseVerboseJson = (payload: WhisperVerboseResponse): StructuredTranscriptionResult => {
    const text = formatVerboseJson(payload);
    if (!Array.isArray(payload.segments)) return { text };
    const segments = payload.segments.flatMap((segment) => {
        if (typeof segment.text !== 'string' || !segment.text.trim()) return [];
        const validStart = Number.isFinite(segment.start) && (segment.start as number) >= 0;
        const startSec = validStart ? segment.start as number : 0;
        const endSec = validStart && Number.isFinite(segment.end) && (segment.end as number) >= startSec ?
            segment.end as number : null;
        const words = endSec === null ? undefined : completeWords(segment);
        return [{ startSec, endSec, text: segment.text,
            ...(words?.length ? { words } : {}) } satisfies SessionTranscriptSegmentV1];
    });
    return { text, segments };
};

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const normalizeChunk = (chunk: unknown): string => {
    if (typeof chunk === 'string') return chunk;
    if (Buffer.isBuffer(chunk)) return chunk.toString('utf8');

    return '';
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
