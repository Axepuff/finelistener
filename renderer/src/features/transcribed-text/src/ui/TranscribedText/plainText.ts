import type { SessionTranscriptV1 } from 'electron/src/types/sessions';
import { projectTranscript } from 'renderer/src/stores/transcriptFormat';
import type { DeepReadonly } from 'renderer/src/stores/types';

const sentenceSegmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });

interface TextSentence {
    id: string;
    text: string;
    startSeconds: number;
    endSeconds: number | null;
    paragraphStart: boolean;
}

export const projectTextSentences = (transcript: DeepReadonly<SessionTranscriptV1> | null): TextSentence[] => {
    const plain = projectTranscript(transcript, 'plain')[0];
    if (!transcript || !plain) return [];

    const originals = transcript.sourceRun?.sources.flatMap((source) => source.status === 'completed' ? source.segments : []) ??
        transcript.recognitionSegments ?? [];
    const rawById = new Map(originals.map((segment) => [segment.id, segment]));
    const wordTimes = plain.members.flatMap(({ segment, startChar }) => {
        const span = segment.rawSpan;
        const original = span && rawById.get(span.segmentId);
        if (original && original.text.slice(span.startChar, span.endChar) !== segment.text) return [];
        return ((original ?? segment).words ?? []).flatMap((word) => {
            const offset = word.startChar - (original ? span.startChar : 0);
            return offset >= 0 && segment.text.slice(offset, offset + word.text.length) === word.text
                && Number.isFinite(word.startSec) && word.startSec >= 0 ? [{ offset: startChar + offset, time: word.startSec }] : [];
        });
    });
    const sentences: TextSentence[] = [];
    let paragraphOffset = 0;
    let memberIndex = 0;
    let wordIndex = 0;
    let previousLastMember = -1;

    const appendSentence = (text: string, offset: number) => {
        const leading = text.length - text.trimStart().length;
        const start = offset + leading;
        const end = offset + text.trimEnd().length;
        if (start >= end) {
            const previous = sentences.at(-1);
            if (previous) previous.text += text;
            return;
        }

        while (memberIndex + 1 < plain.members.length && plain.members[memberIndex].endChar <= start) memberIndex++;
        let lastMember = memberIndex;
        while (lastMember + 1 < plain.members.length && plain.members[lastMember + 1].startChar < end) lastMember++;
        while (wordIndex < wordTimes.length && wordTimes[wordIndex].offset < start) wordIndex++;

        const first = plain.members[memberIndex];
        const word = wordTimes[wordIndex];
        // A sentence that starts within a recognition segment can use its first word's time.
        const startSeconds = start > first.startChar && word && word.offset < Math.min(end, first.endChar) ?
            word.time : first.segment.startSec;
        const paragraphStart = sentences.length === 0 || offset - paragraphOffset >= 320 || /\n\s*\n/u.test(sentences.at(-1)?.text ?? '');
        if (paragraphStart) paragraphOffset = offset;
        const previous = sentences.at(-1);
        if (previous && previousLastMember === memberIndex && startSeconds > previous.startSeconds
            && (previous.endSeconds === null || startSeconds < previous.endSeconds)) {
            previous.endSeconds = startSeconds;
        }
        previousLastMember = lastMember;
        sentences.push({
            id: String(offset),
            text,
            startSeconds,
            endSeconds: plain.members[lastMember].segment.endSec,
            paragraphStart,
        });
    };

    for (const { segment, index } of sentenceSegmenter.segment(plain.text)) appendSentence(segment, index);
    return sentences;
};
