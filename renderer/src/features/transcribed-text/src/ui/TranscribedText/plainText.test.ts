import { deriveSourceTranscript } from '../../../../../../../electron/src/services/transcriptDuplicateFilter';
import { parseVerboseJson } from '../../../../../../../electron/src/services/whisperServer/utils';
import type { SessionTranscriptV1 } from 'electron/src/types/sessions';
import { expect, it } from 'vitest';
import { projectTextSentences } from './plainText';

it('seeks sentences within a timed raw segment and keeps legacy speech seekable', () => {
    const text = 'First sentence. Second sentence.';
    const transcript: SessionTranscriptV1 = {
        version: 1,
        segments: [
            { text, startSec: 0, endSec: 8, rawSpan: { segmentId: 'raw', startChar: 0, endChar: text.length } },
            { text: 'Legacy sentence.', startSec: 9, endSec: null },
        ],
        recognitionSegments: [{
            id: 'raw', text, startSec: 0, endSec: 8,
            words: [{ text: 'Second', startChar: 16, endChar: 22, startSec: 4, endSec: 5 }],
        }],
    };
    const sentences = projectTextSentences(transcript);
    expect(sentences.map(({ text: sentence }) => sentence).join('')).toBe(`${text} Legacy sentence.`);
    expect(sentences.map(({ startSeconds, endSeconds }) => [startSeconds, endSeconds])).toEqual([
        [0, 4], [4, 8], [9, null],
    ]);
});

it.each([undefined, 4])('keeps the start of a sentence audible with an initial word timestamp of %s', (secondStart) => {
    const text = 'First. Second missing timed.';
    const { segments = [] } = parseVerboseJson({ segments: [{
        text, start: 0, end: 10,
        words: [
            { text: 'First. ', start: 0, end: 1 },
            { text: 'Second missing ', start: secondStart, end: secondStart === undefined ? undefined : 7 },
            { text: 'timed.', start: 8, end: 9 },
        ],
    }] });
    const transcript = deriveSourceTranscript({
        status: 'completed', settings: { language: 'en' },
        sources: [{ source: 'system', status: 'completed', segments: segments.map((segment) => ({ ...segment, id: 'raw' })) }],
    }, false);

    const sentences = projectTextSentences(transcript);
    expect(sentences.map((sentence) => sentence.text).join('')).toBe(text);
    expect(sentences.map(({ startSeconds, endSeconds }) => [startSeconds, endSeconds])).toEqual(
        secondStart === undefined ? [[0, 10], [0, 10]] : [[0, 4], [4, 10]],
    );
});
