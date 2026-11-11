import type { SessionTranscriptSegmentV1, SessionTranscriptV1 } from 'electron/src/types/sessions';
import { escapeHtml, formatSecondsReadable } from 'renderer/src/shared/lib';
import type { DeepReadonly } from './types';

export type TranscriptView = 'plain' | 'timecodes' | 'speakers';

export interface TranscriptTurnMember {
    segment: DeepReadonly<SessionTranscriptSegmentV1>;
    startChar: number;
    endChar: number;
}

export interface TranscriptTurn extends SessionTranscriptSegmentV1 {
    members: TranscriptTurnMember[];
}

const joiningWhitespace = (left: string, right: string): string =>
    !left || !right || /\s$/.test(left) || /^\s|^[,.;:!?)}\]]/u.test(right) ? '' : ' ';

export const projectTranscript = (transcript: DeepReadonly<SessionTranscriptV1> | null, view: TranscriptView): TranscriptTurn[] => {
    const turns: TranscriptTurn[] = [];
    const known = new Set(transcript?.speakers?.speakers.map((speaker) => speaker.id) ?? []);
    for (const segment of transcript?.segments ?? []) {
        const prior = turns.at(-1);
        const last = prior?.members.at(-1)?.segment;
        const sameRaw = last?.rawSpan && segment.rawSpan && last.rawSpan.segmentId === segment.rawSpan.segmentId
            && last.rawSpan.endChar === segment.rawSpan.startChar;
        const join = view === 'plain' || (view === 'timecodes' ? sameRaw : (last?.speakerId && known.has(last.speakerId)
            && last.speakerId === segment.speakerId && last.source === segment.source
            && last.endSec !== null && segment.startSec >= last.startSec && segment.startSec - last.endSec <= 5));
        if (prior && join) {
            const separator = sameRaw ? '' : joiningWhitespace(prior.text, segment.text);
            const offset = prior.text.length + separator.length;
            prior.text += separator + segment.text;
            prior.endSec = prior.endSec === null || segment.endSec === null ? null : Math.max(prior.endSec, segment.endSec);
            prior.members.push({ segment, startChar: offset, endChar: offset + segment.text.length });
        } else {
            turns.push({ startSec: segment.startSec, endSec: segment.endSec, text: segment.text,
                source: segment.source, speakerId: segment.speakerId,
                members: [{ segment, startChar: 0, endChar: segment.text.length }] });
        }
    }
    return turns;
};

export const transcriptToPlainText = (transcript: DeepReadonly<SessionTranscriptV1> | null): string =>
    projectTranscript(transcript, 'plain').map((turn) => turn.text).join('');

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

export const formatTranscriptSourcePrefix = (segment: DeepReadonly<SessionTranscriptSegmentV1>): string => {
    const label = segment.source === 'system' ? 'System audio' : segment.source === 'microphone' ? 'Microphone' : null;

    return label ? `${label}: ` : '';
};

export const formatTranscriptPrefix = (
    segment: DeepReadonly<SessionTranscriptSegmentV1>,
    transcript?: DeepReadonly<SessionTranscriptV1> | null,
): string => {
    const source = formatTranscriptSourcePrefix(segment);

    if (!transcript?.speakers) return source;

    const speaker = transcript.speakers.speakers.find((identity) => identity.id === segment.speakerId);
    const label = speaker?.name ?? 'Unknown speaker';

    return source ? `${source.slice(0, -2)} · ${label}: ` : `${label}: `;
};

export const formatTranscriptSegment = (
    segment: DeepReadonly<SessionTranscriptSegmentV1>,
    transcript?: DeepReadonly<SessionTranscriptV1> | null,
): string => `${formatTranscriptPrefix(segment, transcript)}${segment.text}`;

export const formatTranscriptRegionLabel = (segment: DeepReadonly<SessionTranscriptSegmentV1>): string => {
    const startLabel = formatSecondsReadable(segment.startSec);
    const endLabel = segment.endSec === null ? null : formatSecondsReadable(segment.endSec);

    return endLabel ? `[${startLabel} - ${endLabel}]` : `[${startLabel}]`;
};

export const transcriptToText = (transcript: DeepReadonly<SessionTranscriptV1> | null, view: TranscriptView = 'timecodes'): string => {
    if (view === 'plain') return transcriptToPlainText(transcript);
    if (!transcript) return '';

    const lines = projectTranscript(transcript, view).map((segment) => {
        if (view === 'speakers') return formatTranscriptSegment(segment, transcript).trimEnd();
        const startLabel = formatSecondsReadable(segment.startSec);
        const endLabel = segment.endSec === null ? null : formatSecondsReadable(segment.endSec);
        const label = endLabel ? `[${startLabel} --> ${endLabel}]` : `[${startLabel}]`;

        return `${label} ${formatTranscriptSegment(segment)}`.trimEnd();
    });

    return lines.length > 0 ? `${lines.join('\n')}\n` : '';
};

export const transcriptToHtml = (transcript: DeepReadonly<SessionTranscriptV1> | null, view: TranscriptView = 'timecodes'): string => {
    if (view === 'plain') return escapeHtml(transcriptToPlainText(transcript));
    if (!transcript) return '';

    const lines = projectTranscript(transcript, view).map((segment) => {
        if (view === 'speakers') return `<p><strong>${escapeHtml(formatTranscriptPrefix(segment, transcript))}</strong>${escapeHtml(segment.text)}</p>`;
        const label = formatTranscriptRegionLabel(segment);
        const region = Number.isFinite(segment.startSec) ? segment.startSec.toFixed(3) : '0';

        return `<span data-regions="${escapeHtml(region)}">${escapeHtml(label)}</span>${segment.text ? ` ${escapeHtml(formatTranscriptSegment(segment))}` : ''}`;
    });

    return lines.length > 0 ? `${lines.join('\n')}\n` : '';
};
