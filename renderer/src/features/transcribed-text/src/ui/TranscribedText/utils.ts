import type { TrimRange } from 'renderer/src/atoms';

const collapseWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

interface TranscribedSegment {
    text: string;
    startSeconds: number | null;
}

export const resolveTrimOffset = (range?: TrimRange) => {
    const start = range?.start;

    return typeof start === 'number' && Number.isFinite(start) ? start : 0;
};

export const formatSecondsReadable = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '';

    const totalMs = Math.round(seconds * 1000);
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

export const escapeHtml = (value: string) =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

export const parseTimeToSeconds = (value: string): number | null => {
    const sanitized = value.trim().replace(',', '.');

    if (!sanitized) return null;

    const parts = sanitized.split(':').map((part) => part.trim());

    if (parts.some((part) => part === '')) return null;

    let totalSeconds = 0;

    for (const part of parts) {
        const numeric = Number(part);

        if (Number.isNaN(numeric)) return null;

        totalSeconds = totalSeconds * 60 + numeric;
    }

    return totalSeconds;
};

const resolveAdjustedSeconds = (rawSeconds: string, trimOffset: number) => {
    const parsed = parseTimeToSeconds(rawSeconds);

    if (parsed === null) return null;

    const adjustedSeconds = parsed + trimOffset;

    if (!Number.isFinite(adjustedSeconds)) return null;

    return Number(adjustedSeconds.toFixed(3));
};

export const buildPlainSegments = (source: string, trimOffset: number): TranscribedSegment[] => {
    if (!source) return [];

    const regionPattern = /\[([^\]]+)\]\s*/g;
    const matches = Array.from(source.matchAll(regionPattern));

    if (matches.length === 0) {
        const text = collapseWhitespace(source);

        return text ? [{ text, startSeconds: null }] : [];
    }

    const segments: TranscribedSegment[] = [];

    const pushSegment = (text: string, regionContent?: string) => {
        const normalizedText = collapseWhitespace(text);

        if (!normalizedText) return;

        const [rawStart = ''] = regionContent?.split('-->') ?? [];
        const startSeconds = rawStart ? resolveAdjustedSeconds(rawStart.trim(), trimOffset) : null;

        segments.push({ text: normalizedText, startSeconds });
    };

    const firstMatchIndex = matches[0]?.index ?? 0;

    if (firstMatchIndex > 0) {
        pushSegment(source.slice(0, firstMatchIndex));
    }

    matches.forEach((match, index) => {
        const matchIndex = match.index ?? 0;
        const contentStart = matchIndex + match[0].length;
        const contentEnd = matches[index + 1]?.index ?? source.length;

        pushSegment(source.slice(contentStart, contentEnd), match[1]);
    });

    return segments;
};
