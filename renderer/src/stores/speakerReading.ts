import type {
    SessionRecognitionWord, SessionSpeakerCorrection, SessionSpeakerInterval, SessionSpeakerMetadataV1, SessionTranscriptSegmentV1, SessionTranscriptV1,
} from 'electron/src/types/sessions';
import { assignedSpeaker, completeWordTimings, fallbackSpeaker } from '../../../electron/src/utils/speakerAssignment';
import { projectTranscript } from './transcriptFormat';
import type { DeepReadonly } from './types';

export interface SpeakerReadingWord {
    startChar: number;
    endChar: number;
    startSec: number | null;
    speakerId: string | null;
    overlap: boolean;
    estimated: boolean;
}

export interface SpeakerReadingParagraph {
    offset: number;
    text: string;
    words: SpeakerReadingWord[];
}

const sentenceSegmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });

// Community-1 used exclusive intervals for word ownership and regular intervals
// for acoustic overlap. Recover the original assignment before suggesting a color.
const indexRemovedAssignments = (metadata: DeepReadonly<SessionSpeakerMetadataV1> | undefined) => {
    const removed = new Set(metadata?.merges?.filter((merge) => merge.toId === null).map((merge) => merge.fromId));
    if (!metadata || !removed.size) return () => false;
    const cache = new Map<DeepReadonly<SessionTranscriptSegmentV1>, (word: SessionRecognitionWord) => string | null>();
    return (raw: DeepReadonly<SessionTranscriptSegmentV1>, word: SessionRecognitionWord): boolean => {
        let owner = cache.get(raw);
        if (!owner) {
            const intervals = metadata.intervals.filter((interval) => interval.endSec > raw.startSec - 0.05
                && (raw.endSec === null || interval.startSec < raw.endSec + 0.05));
            if (completeWordTimings(raw)) {
                owner = (w) => assignedSpeaker(w.startSec, w.endSec, intervals);
            } else {
                const segmentOwner = fallbackSpeaker(raw, intervals);
                owner = () => segmentOwner;
            }
            cache.set(raw, owner);
        }
        const id = owner(word);
        return id !== null && removed.has(id);
    };
};

// A long voice interval may begin well before a word. Index the furthest end seen
// so words from interleaved recording tracks can be looked up in any time order.
const indexVoiceActivity = (metadata: DeepReadonly<SessionSpeakerMetadataV1> | undefined) => {
    const source = metadata?.provenance;
    const intervals = source?.engine === 'nemotron-3' ? source.acousticIntervals : source?.regularIntervals ?? metadata?.intervals ?? [];
    const known = new Set(metadata?.speakers.map((speaker) => speaker.id));
    const merges = new Map(metadata?.merges?.map(({ fromId, toId }) => [fromId, toId]));
    const bySpeaker = new Map<string, SessionSpeakerInterval[]>();
    for (const interval of [...intervals].sort((a, b) => a.startSec - b.startSec)) {
        const { startSec, endSec } = interval;
        const mergedInto = merges.get(interval.speakerId);
        // A voice merged into Unknown still contributed acoustic evidence. Keep its
        // original ID for ranking so a shorter, known voice cannot replace it.
        const speakerId = mergedInto ?? interval.speakerId;
        if ((mergedInto !== null && !known.has(speakerId)) || !Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) continue;
        const voice = bySpeaker.get(speakerId) ?? [];
        const previous = voice.at(-1);
        if (previous && startSec <= previous.endSec) previous.endSec = Math.max(previous.endSec, endSec);
        else voice.push({ startSec, endSec, speakerId });
        bySpeaker.set(speakerId, voice);
    }
    const ordered = [...bySpeaker.values()].flat().sort((a, b) => a.startSec - b.startSec || a.speakerId.localeCompare(b.speakerId));
    let furthest = -Infinity;
    const prefixEnds = ordered.map(({ endSec }) => (furthest = Math.max(furthest, endSec)));

    return (start: number, end: number): string | null => {
        let first = 0;
        let last = ordered.length;
        while (first < last) {
            const middle = Math.floor((first + last) / 2);
            if (prefixEnds[middle] <= start) first = middle + 1;
            else last = middle;
        }
        let overlap = false;
        let previousEnd = start;
        const totals = new Map<string, { coverage: number; longestPassage: number }>();
        for (let i = first; i < ordered.length && ordered[i].startSec < end; i++) {
            const interval = ordered[i];
            if (interval.endSec <= start) continue;
            const left = Math.max(start, interval.startSec);
            const right = Math.min(end, interval.endSec);
            overlap ||= left < previousEnd;
            previousEnd = Math.max(previousEnd, right);
            const total = totals.get(interval.speakerId) ?? { coverage: 0, longestPassage: 0 };
            total.coverage += Math.round(right * 1e6) - Math.round(left * 1e6);
            total.longestPassage = Math.max(total.longestPassage, Math.round((interval.endSec - interval.startSec) * 1e6));
            totals.set(interval.speakerId, total);
        }
        if (!overlap) return null;
        // A stable sort keeps the first voice in timeline order when both measures tie.
        return [...totals].sort(([, a], [, b]) => b.coverage - a.coverage || b.longestPassage - a.longestPassage)[0][0];
    };
};

const readingParagraphs = (text: string, words: SpeakerReadingWord[]): SpeakerReadingParagraph[] => {
    const paragraphs: SpeakerReadingParagraph[] = [];
    let offset = 0;
    let firstWord = 0;
    let nextWord = 0;
    const append = (end: number) => {
        paragraphs.push({ offset, text: text.slice(offset, end), words: words.slice(firstWord, nextWord).map((w) => ({
            ...w, startChar: w.startChar - offset, endChar: w.endChar - offset,
        })) });
        firstWord = nextWord;
        offset = end;
    };
    for (const sentence of sentenceSegmenter.segment(text)) {
        const end = sentence.index + sentence.segment.length;
        while (nextWord < words.length && words[nextWord].endChar <= end) nextWord++;
        if (nextWord - firstWord >= 50 && words.length - nextWord >= 20) append(end);
    }
    if (offset < text.length) append(text.length);
    return paragraphs;
};

export const projectSpeakerReading = (transcript: DeepReadonly<SessionTranscriptV1> | null): SpeakerReadingParagraph[] => {
    const plain = projectTranscript(transcript, 'plain')[0];
    if (!plain || !transcript) return [];
    const rawSegments = transcript.sourceRun?.sources.flatMap((s) => s.status === 'completed' ? s.segments : []) ??
        transcript.recognitionSegments ?? [];
    const rawById = new Map(rawSegments.map((s) => [s.id, s]));
    const timedWords = new Map<DeepReadonly<SessionTranscriptSegmentV1>, Map<number, SessionRecognitionWord>>();
    const known = new Set(transcript.speakers?.speakers.map((s) => s.id));
    const metadata = transcript.speakers;
    const corrections = new Map<string, SessionSpeakerCorrection[]>();
    for (const correction of metadata?.corrections ?? []) {
        const group = corrections.get(correction.segmentId);
        if (group) group.push(correction);
        else corrections.set(correction.segmentId, [correction]);
    }
    const activeMetadata = metadata?.status === 'completed'
        && (!transcript.recognitionRevision || metadata.recognitionRevision === transcript.recognitionRevision) ? metadata : undefined;
    const primaryInOverlap = indexVoiceActivity(activeMetadata);
    const wasMergedIntoUnknown = indexRemovedAssignments(activeMetadata);
    const words: SpeakerReadingWord[] = [];
    for (const { segment, startChar: memberStart } of plain.members) {
        const span = segment.rawSpan;
        const original = span && rawById.get(span.segmentId);
        const raw = original ?? segment;
        const rawStart = span?.startChar ?? 0;
        const aligned = !original || original.text.slice(rawStart, span?.endChar) === segment.text;
        let byOffset = timedWords.get(raw);
        if (!byOffset) {
            byOffset = new Map(raw.words?.map((word) => [word.startChar, word]));
            timedWords.set(raw, byOffset);
        }
        const assigned = segment.speakerId && known.has(segment.speakerId) ? segment.speakerId : null;
        const edits = span && corrections.get(span.segmentId);
        for (const match of segment.text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)) {
            const first = rawStart + match.index;
            const last = first + match[0].length;
            const time = aligned ? byOffset.get(first) : undefined;
            const timed = time && time.text === match[0] && time.endChar === last
                && Number.isFinite(time.startSec) && Number.isFinite(time.endSec) && time.startSec >= 0 && time.endSec > time.startSec
                && time.startSec >= raw.startSec - 0.05 && (raw.endSec === null || time.endSec <= raw.endSec + 0.05);
            const primary = timed && !(transcript.sourceRun && segment.source === 'microphone') ?
                primaryInOverlap(time.startSec, time.endSec) : null;
            const estimated = !assigned && time !== undefined && primary !== null && known.has(primary)
                && !edits?.some((edit) => edit.startChar < last && edit.endChar > first) && !wasMergedIntoUnknown(raw, time);
            const startChar = memberStart + match.index;
            words.push({ startChar, endChar: startChar + match[0].length, startSec: timed ? time.startSec : null,
                speakerId: estimated ? primary : assigned, overlap: primary !== null, estimated });
        }
    }
    return readingParagraphs(plain.text, words);
};
