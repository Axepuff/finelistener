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
