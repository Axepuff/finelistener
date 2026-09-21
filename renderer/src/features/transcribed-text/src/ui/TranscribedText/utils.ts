import type { SegmentSelection } from 'renderer/src/stores';

const collapseWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

interface TranscribedSegment {
    text: string;
    startSeconds: number | null;
}

export const resolveTrimOffset = (range?: SegmentSelection) => {
    const start = range?.start;

    return typeof start === 'number' && Number.isFinite(start) ? start : 0;
};

export { escapeHtml, formatSecondsReadable } from 'renderer/src/shared/lib';

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
