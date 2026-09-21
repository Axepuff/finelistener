import type { SessionTranscriptSegmentV1, SessionTranscriptV1 } from 'electron/src/types/sessions';
import { escapeHtml, formatSecondsReadable } from 'renderer/src/shared/lib';
import type { DeepReadonly } from './types';

const TRANSCRIPT_LINE_REGEX =
    /^\[(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\]\s*(.*)$/;

const parseTimestamp = (match: RegExpMatchArray, offset: number): number => {
    const hours = Number(match[offset]);
    const minutes = Number(match[offset + 1]);
    const seconds = Number(match[offset + 2]);
    const milliseconds = Number(match[offset + 3]);

    return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
};

export const parseTranscript = (
    source: string,
    offsetSeconds = 0,
    includeUnmatchedLines = false,
): SessionTranscriptV1 => {
    const segments: SessionTranscriptSegmentV1[] = [];
    const safeOffset = Number.isFinite(offsetSeconds) && offsetSeconds > 0 ? offsetSeconds : 0;

    for (const rawLine of source.split('\n')) {
        const match = rawLine.replace(/\r$/, '').match(TRANSCRIPT_LINE_REGEX);

        if (!match) {
            const text = rawLine.trim();

            if (includeUnmatchedLines && text) {
                segments.push({ startSec: safeOffset, endSec: null, text });
            }

            continue;
        }

        const text = (match[9] ?? '').trim();

        if (!text) continue;

        segments.push({
            startSec: parseTimestamp(match, 1) + safeOffset,
            endSec: parseTimestamp(match, 5) + safeOffset,
            text,
        });
    }

    if (!includeUnmatchedLines && segments.length === 0 && source.trim()) {
        segments.push({ startSec: safeOffset, endSec: null, text: source.trim() });
    }

    return { version: 1, segments };
};

export const formatTranscriptSegment = (segment: DeepReadonly<SessionTranscriptSegmentV1>): string => {
    const label = segment.source === 'system' ? 'System audio' : segment.source === 'microphone' ? 'Microphone' : null;

    return label ? `${label}: ${segment.text}` : segment.text;
};

export const transcriptToTimecodedText = (transcript: DeepReadonly<SessionTranscriptV1> | null): string => {
    if (!transcript) return '';

    const lines = transcript.segments.map((segment) => {
        const startLabel = formatSecondsReadable(segment.startSec);
        const endLabel = segment.endSec === null ? null : formatSecondsReadable(segment.endSec);
        const label = endLabel ? `[${startLabel} --> ${endLabel}]` : `[${startLabel}]`;

        return `${label} ${formatTranscriptSegment(segment)}`.trimEnd();
    });

    return lines.length > 0 ? `${lines.join('\n')}\n` : '';
};

export const transcriptToHtml = (transcript: DeepReadonly<SessionTranscriptV1> | null): string => {
    if (!transcript) return '';

    const lines = transcript.segments.map((segment) => {
        const startLabel = formatSecondsReadable(segment.startSec);
        const endLabel = segment.endSec === null ? null : formatSecondsReadable(segment.endSec);
        const label = endLabel ? `[${startLabel} - ${endLabel}]` : `[${startLabel}]`;
        const region = Number.isFinite(segment.startSec) ? segment.startSec.toFixed(3) : '0';

        return `<span data-regions="${escapeHtml(region)}">${escapeHtml(label)}</span>${segment.text ? ` ${escapeHtml(formatTranscriptSegment(segment))}` : ''}`;
    });

    return lines.length > 0 ? `${lines.join('\n')}\n` : '';
};
