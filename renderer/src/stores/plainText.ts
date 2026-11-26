import type { SessionTranscriptV1 } from 'electron/src/types/sessions';
import { projectTranscript } from './transcriptFormat';
import type { DeepReadonly } from './types';

const sentenceSegmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });

interface TextSentence {
    id: string;
    text: string;
    startSeconds: number;
    playbackStartSeconds: number;
    endSeconds: number | null;
    paragraphStart: boolean;
}

export const projectTextSentences = (transcript: DeepReadonly<SessionTranscriptV1> | null): TextSentence[] => {
    const plain = projectTranscript(transcript, 'plain')[0];
    if (!transcript || !plain) return [];

    const originals = transcript.sourceRun?.sources.flatMap((source) => source.status === 'completed' ? source.segments : []) ??
        transcript.recognitionSegments ?? [];
    const rawById = new Map(originals.map((segment) => [segment.id, segment]));
    const members = plain.members.map((member) => {
        const { segment } = member;
        const span = segment.rawSpan;
        const original = span && rawById.get(span.segmentId);
        const aligned = original && original.text.slice(span.startChar, span.endChar) === segment.text;
        return {
            ...member,
            original: aligned ? original : undefined,
            rawOffset: aligned ? span.startChar : 0,
            words: original && !aligned ? [] : (original ?? segment).words ?? [],
        };
    });
    const wordTimes = members.flatMap(({ segment, startChar, rawOffset, words }) => words.flatMap((word) => {
        const offset = word.startChar - rawOffset;
        return offset >= 0 && segment.text.slice(offset, offset + word.text.length) === word.text
            && Number.isFinite(word.startSec) && word.startSec >= 0 ? [{ offset: startChar + offset, time: word.startSec }] : [];
    }));
    const sentences: TextSentence[] = [];
    let paragraphOffset = 0;
    let memberIndex = 0;
    let wordIndex = 0;
    let previousLastMember = -1;
    let passageStartIndex = 0;

    const appendSentence = (text: string, offset: number) => {
        const leading = text.length - text.trimStart().length;
        const start = offset + leading;
        const end = offset + text.trimEnd().length;
        if (start >= end) {
            const previous = sentences.at(-1);
            if (previous) previous.text += text;
            return;
        }

        while (memberIndex + 1 < members.length && members[memberIndex].endChar <= start) memberIndex++;
        let lastMember = memberIndex;
        while (lastMember + 1 < members.length && members[lastMember + 1].startChar < end) lastMember++;
        while (wordIndex < wordTimes.length && wordTimes[wordIndex].offset < start) wordIndex++;

        const first = members[memberIndex];
        const word = wordTimes[wordIndex];
        const firstWordOffset = text.search(/[\p{L}\p{N}]/u);
        const timedStart = firstWordOffset >= 0 && word?.offset === offset + firstWordOffset
            && word.offset < first.endChar ? word.time : undefined;
        const startSeconds = timedStart ?? first.original?.startSec ?? first.segment.startSec;
        const paragraphStart = sentences.length === 0 || offset - paragraphOffset >= 320 || /\n\s*\n/u.test(sentences.at(-1)?.text ?? '');
        if (paragraphStart) paragraphOffset = offset;

        const previous = sentences.at(-1);
        const sharesMember = previous && previousLastMember === memberIndex;
        // Without a measured boundary, the sentences share one playing passage.
        const playbackStartSeconds = timedStart ?? (sharesMember ? previous.playbackStartSeconds : first.segment.startSec);
        if (!sharesMember) {
            passageStartIndex = sentences.length;
        } else if (playbackStartSeconds > previous.playbackStartSeconds) {
            for (let i = passageStartIndex; i < sentences.length; i++) {
                const sentence = sentences[i];
                if (sentence.endSeconds === null || playbackStartSeconds < sentence.endSeconds) {
                    sentence.endSeconds = playbackStartSeconds;
                }
            }
            passageStartIndex = sentences.length;
        }
        previousLastMember = lastMember;
        sentences.push({
            id: String(offset),
            text,
            startSeconds,
            playbackStartSeconds,
            endSeconds: members[lastMember].segment.endSec,
            paragraphStart,
        });
    };

    for (const { segment, index } of sentenceSegmenter.segment(plain.text)) appendSentence(segment, index);
    return sentences;
};
