import { createHash, randomUUID } from 'crypto';
import type {
    SessionSpeakerInterval, SessionSpeakerMetadataV1, SessionTranscriptSegmentV1, SessionTranscriptV1,
} from '../types/sessions';
import type { StructuredTranscriptionResult } from './whisperServer/utils';
import { deriveSourceTranscript } from './transcriptDuplicateFilter';

const TRANSCRIPT_LINE_REGEX =
    /^\[(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]\s*(.*)$/;

const parseTimestampToSeconds = (match: RegExpMatchArray, offset: number): number => {
    const hours = Number(match[offset + 0]);
    const minutes = Number(match[offset + 1]);
    const seconds = Number(match[offset + 2]);
    const ms = Number(match[offset + 3]);

    if (
        !Number.isFinite(hours)
        || !Number.isFinite(minutes)
        || !Number.isFinite(seconds)
        || !Number.isFinite(ms)
    ) {
        return 0;
    }

    return hours * 3600 + minutes * 60 + seconds + ms / 1000;
};

export const parseTranscriptToV1 = (text: string, offsetSec: number): SessionTranscriptV1 => {
    const segments: SessionTranscriptSegmentV1[] = [];
    const safeOffset = Number.isFinite(offsetSec) && offsetSec > 0 ? offsetSec : 0;

    for (const rawLine of text.split('\n')) {
        const line = rawLine.replace(/\r$/, '');

        const match = line.match(TRANSCRIPT_LINE_REGEX);

        if (!match) continue;

        const start = parseTimestampToSeconds(match, 1) + safeOffset;
        const end = parseTimestampToSeconds(match, 5) + safeOffset;
        const chunkText = (match[9] ?? '').trim();

        if (!chunkText) continue;

        segments.push({
            startSec: start,
            endSec: Number.isFinite(end) ? end : null,
            text: chunkText,
        });
    }

    if (segments.length === 0) {
        const fallback = text.trim();

        if (fallback) {
            segments.push({ startSec: safeOffset, endSec: null, text: fallback });
        }
    }

    return { version: 1, segments };
};

export const transcriptionResultToTranscript = (
    result: StructuredTranscriptionResult, offsetSec: number,
): SessionTranscriptV1 => {
    const offset = Number.isFinite(offsetSec) ? offsetSec : 0;
    const segments = result.segments?.length ? result.segments.map((segment) => ({ ...segment,
        startSec: segment.startSec + offset,
        endSec: segment.endSec === null ? null : segment.endSec + offset,
        words: segment.words?.map((word) => ({ ...word,
            startSec: word.startSec + offset, endSec: word.endSec + offset })),
    })) : parseTranscriptToV1(result.text, offset).segments;
    return materializeRecognitionTranscript({ version: 1, segments, recognitionRevision: randomUUID() });
};

const rawSegments = (transcript: SessionTranscriptV1): SessionTranscriptSegmentV1[] => transcript.sourceRun ?
    transcript.sourceRun.sources.flatMap((source) => source.status === 'completed' ?
        source.segments.map((segment) => ({ ...segment, source: source.source })) : []) :
    transcript.recognitionSegments ?? transcript.segments;

export const materializeRecognitionTranscript = (transcript: SessionTranscriptV1): SessionTranscriptV1 => {
    const result = structuredClone(transcript);
    if (result.sourceRun) {
        for (const source of result.sourceRun.sources) {
            source.segments = source.segments.map((segment, index) => ({ ...segment,
                id: segment.id ?? `${source.source}:${index}:${createHash('sha256').update(JSON.stringify([
                    segment.startSec, segment.endSec, segment.text,
                ])).digest('hex').slice(0, 12)}`,
            }));
        }
    } else {
        result.recognitionSegments = (result.recognitionSegments ?? result.segments).map((segment, index) => ({
            ...segment,
            id: segment.id ?? `imported:${index}:${createHash('sha256').update(JSON.stringify([
                segment.startSec, segment.endSec, segment.text,
            ])).digest('hex').slice(0, 12)}`,
        }));
    }
    const recognition = rawSegments(result);
    result.recognitionRevision ??= createHash('sha256').update(JSON.stringify(recognition.map((segment) => [
        segment.id, segment.source, segment.startSec, segment.endSec, segment.text, segment.words,
    ]))).digest('hex');
    return result;
};

export const createSpeakerMetadata = (
    transcript: SessionTranscriptV1,
    intervals: SessionSpeakerInterval[],
    settings: SessionSpeakerMetadataV1['settings'],
    generation: string,
): SessionSpeakerMetadataV1 => {
    const recognition = materializeRecognitionTranscript(transcript);
    const recognized = rawSegments(recognition);
    const hasMicrophoneSpeech = Boolean(recognition.sourceRun) && recognized.some((segment) =>
        segment.source === 'microphone' && segment.text.trim().length > 0);
    const speakers = hasMicrophoneSpeech ? [{ id: `${generation}:microphone`, name: 'Microphone speaker' }] : [];
    const relevantIntervals = recognized.some((segment) => segment.text.trim()) ? intervals : [];
    const acousticIds = [...new Set([...relevantIntervals].sort((a, b) => a.startSec - b.startSec)
        .map((interval) => interval.speakerId))];
    for (const [index, id] of acousticIds.entries()) {
        if (!speakers.some((speaker) => speaker.id === id)) speakers.push({ id, name: `Speaker ${index + 1}` });
    }
    return { version: 1, recognitionRevision: recognition.recognitionRevision ?? '', generation,
        settings, intervals: structuredClone(relevantIntervals), speakers, corrections: [], status: 'completed' };
};

const assignedSpeaker = (startSec: number, endSec: number, intervals: SessionSpeakerInterval[]): string | null => {
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) return null;
    const boundaries = [startSec, endSec];
    for (const interval of intervals) {
        if (!Number.isFinite(interval.startSec) || !Number.isFinite(interval.endSec)
            || interval.endSec <= interval.startSec) continue;
        if (interval.startSec > startSec && interval.startSec < endSec) boundaries.push(interval.startSec);
        if (interval.endSec > startSec && interval.endSec < endSec) boundaries.push(interval.endSec);
    }
    boundaries.sort((a, b) => a - b);
    const coverage = new Map<string, number>();
    for (let index = 0; index < boundaries.length - 1; index += 1) {
        // Touching intervals add the same boundary twice; a shared endpoint is not overlapping speech.
        if (boundaries[index + 1] <= boundaries[index]) continue;
        const middle = (boundaries[index] + boundaries[index + 1]) / 2;
        const active = new Set(intervals.filter((item) => item.startSec <= middle && item.endSec >= middle)
            .map((item) => item.speakerId));
        // Ambiguous time casts no vote; a speaker must still own most of the full word alone.
        if (active.size > 1) continue;
        const id = [...active][0];
        if (id) coverage.set(id, (coverage.get(id) ?? 0) + boundaries[index + 1] - boundaries[index]);
    }
    // Decimal boundaries can round exact half coverage upward, especially late in a recording.
    const roundingTolerance = Number.EPSILON * Math.max(1, Math.abs(startSec), Math.abs(endSec)) * boundaries.length;
    const majority = [...coverage].filter(([, duration]) =>
        duration - (endSec - startSec) / 2 > roundingTolerance);
    return majority.length === 1 ? majority[0][0] : null;
};

const fallbackSpeaker = (segment: SessionTranscriptSegmentV1, intervals: SessionSpeakerInterval[]): string | null => {
    if (segment.endSec === null || !Number.isFinite(segment.endSec)) return null;
    const ids = new Set(intervals.filter((item) => item.startSec < segment.endSec!
        && item.endSec > segment.startSec).map((item) => item.speakerId));
    return ids.size === 1 ? [...ids][0] : null;
};

export const deriveSpeakerTranscript = (transcript: SessionTranscriptV1): SessionTranscriptV1 => {
    const materialized = materializeRecognitionTranscript(transcript);
    const baseline = materialized.sourceRun ? deriveSourceTranscript(materialized.sourceRun,
        materialized.presentation?.duplicateFilter?.enabled ?? true) : {
        ...materialized,
        segments: materialized.recognitionSegments?.map((segment) => ({ ...segment,
            rawSpan: { segmentId: segment.id!, startChar: 0, endChar: segment.text.length },
        })) ?? [],
    };
    const metadata = materialized.speakers;
    if (!metadata || metadata.recognitionRevision !== materialized.recognitionRevision || metadata.status !== 'completed') {
        return { ...materialized, segments: baseline.segments,
            presentation: baseline.presentation ?? materialized.presentation };
    }
    if (metadata.provenance?.engine === 'nemotron-3') {
        metadata.provenance.assignmentPolicy = 'exclusive-majority-v2';
    }
    const rawById = new Map(rawSegments(materialized).map((segment) => [segment.id, segment]));
    const microphoneId = `${metadata.generation}:microphone`;
    const resolveMerge = (id: string | null): string | null => {
        let current = id;
        const visited = new Set<string>();
        while (current && !visited.has(current)) {
            visited.add(current);
            const target = metadata.merges?.find((merge) => merge.fromId === current)?.toId;
            if (target === undefined) break;
            current = target;
        }
        return current;
    };
    const segments = baseline.segments.flatMap((visible) => {
        const span = visible.rawSpan;
        const raw = span ? rawById.get(span.segmentId) : undefined;
        if (!span || !raw) return [{ ...visible, speakerId: null }];
        const start = span.startChar;
        const end = span.endChar;
        const isMicrophone = Boolean(materialized.sourceRun) && visible.source === 'microphone';
        const scopedIntervals = isMicrophone ? [] : metadata.intervals;
        const validWords = raw.words?.filter((word) => word.startChar >= start && word.endChar <= end
            && word.endChar > word.startChar && raw.text.slice(word.startChar, word.endChar) === word.text
            && Number.isFinite(word.startSec) && Number.isFinite(word.endSec) && word.endSec > word.startSec
            && word.startSec >= raw.startSec - 0.05 && (raw.endSec === null || word.endSec <= raw.endSec + 0.05));
        const completeWords = [...raw.text.slice(start, end).matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)]
            .map((match) => ({ startChar: start + (match.index ?? 0),
                endChar: start + (match.index ?? 0) + match[0].length }));
        const corrected = (speakerId: string | null, first: number, last: number): string | null => {
            let result = speakerId;
            for (const item of metadata.corrections) {
                if (item.segmentId === span.segmentId && item.startChar < last && item.endChar > first) {
                    result = item.speakerId;
                }
            }
            return resolveMerge(result);
        };
        if (!validWords?.length || validWords.length !== completeWords.length
            || validWords.some((word, index) => word.startChar !== completeWords[index].startChar
                || word.endChar !== completeWords[index].endChar)) {
            const speakerId = isMicrophone ? microphoneId :
                fallbackSpeaker(raw, scopedIntervals);
            return [{ ...visible, speakerId: corrected(speakerId, start, end) }];
        }
        const groups: Array<{
            startChar: number; endChar: number; startSec: number; endSec: number; speakerId: string | null;
        }> = [];
        for (const [index, word] of validWords.entries()) {
            const partStart = index === 0 ? start : word.startChar;
            const partEnd = validWords[index + 1]?.startChar ?? end;
            const automatic = isMicrophone ? microphoneId :
                assignedSpeaker(word.startSec, word.endSec, scopedIntervals);
            const speakerId = corrected(automatic, word.startChar, word.endChar);
            const prior = groups.at(-1);
            if (prior?.speakerId === speakerId) {
                prior.endChar = partEnd;
                prior.startSec = Math.min(prior.startSec, word.startSec);
                prior.endSec = Math.max(prior.endSec, word.endSec);
            } else groups.push({ startChar: partStart, endChar: partEnd,
                startSec: word.startSec, endSec: word.endSec, speakerId });
        }
        return groups.map((group) => ({ ...visible, text: raw.text.slice(group.startChar, group.endChar),
            startSec: group.startSec, endSec: group.endSec,
            rawSpan: { segmentId: span.segmentId, startChar: group.startChar, endChar: group.endChar },
            speakerId: group.speakerId,
        }));
    });
    return { ...materialized, segments, presentation: baseline.presentation ?? materialized.presentation };
};

