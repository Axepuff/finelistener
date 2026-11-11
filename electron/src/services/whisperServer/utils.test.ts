import { expect, it } from 'vitest';
import { parseVerboseJson } from './utils';

it('groups Russian subword pieces into timed complete words and preserves original text', () => {
    const result = parseVerboseJson({ segments: [{ start: 0, end: 2, text: ' Привет, мир!', words: [
        { text: ' Пр', start: 0, end: 0.3 },
        { text: 'ивет', start: 0.3, end: 0.8 },
        { text: ',', start: 0.8, end: 0.9 },
        { text: ' мир', start: 1, end: 1.6 },
        { text: '!', start: 1.6, end: 1.7 },
    ] }] });
    expect(result.segments?.[0].text).toBe(' Привет, мир!');
    expect(result.segments?.[0].words).toEqual([
        { text: 'Привет', startChar: 1, endChar: 7, startSec: 0, endSec: 0.8 },
        { text: 'мир', startChar: 9, endChar: 12, startSec: 1, endSec: 1.6 },
    ]);
});

it('keeps valid word timing when punctuation has no duration', () => {
    const result = parseVerboseJson({ segments: [{ start: 0, end: 2, text: 'Hello, world', words: [
        { word: 'Hello', start: 0.1, end: 0.5 },
        { word: ',', start: 0.5, end: 0.5 },
        { word: ' world', start: 1, end: 1.6 },
    ] }] });
    expect(result.segments?.[0].words).toEqual([
        { text: 'Hello', startChar: 0, endChar: 5, startSec: 0.1, endSec: 0.5 },
        { text: 'world', startChar: 7, endChar: 12, startSec: 1, endSec: 1.6 },
    ]);
});

it('does not assign timing to a word containing an untimed subword piece', () => {
    const result = parseVerboseJson({ segments: [{ start: 0, end: 2, text: 'Hello, world', words: [
        { word: 'Hello', start: 0.1, end: 0.5 },
        { word: ',', start: 0.5, end: 0.5 },
        { word: ' wor', start: 1, end: 1.3 },
        { word: 'ld', start: 1.3, end: 1.3 },
    ] }] });
    expect(result.segments?.[0].words).toEqual([
        { text: 'Hello', startChar: 0, endChar: 5, startSec: 0.1, endSec: 0.5 },
    ]);
});

it('keeps recognition text without guessed word timing when pieces do not match', () => {
    const result = parseVerboseJson({ segments: [{ start: 0, end: 1, text: 'Hello', words: [
        { text: 'Helo', start: 0, end: 1 },
    ] }] });
    expect(result.segments).toEqual([{ startSec: 0, endSec: 1, text: 'Hello' }]);
});

it('retains plain text when verbose JSON has no usable segments', () => {
    expect(parseVerboseJson({ text: 'Fallback', segments: [] })).toEqual({ text: 'Fallback', segments: [] });
});

it('retains segment text when a timestamp is missing or invalid', () => {
    const result = parseVerboseJson({ segments: [
        { start: 0, end: 1, text: ' First' },
        { start: -2, end: 2, text: ' second' },
        { start: 3, end: Number.POSITIVE_INFINITY, text: ' third' },
    ] });

    expect(result.segments).toEqual([
        { startSec: 0, endSec: 1, text: ' First' },
        { startSec: 0, endSec: null, text: ' second' },
        { startSec: 3, endSec: null, text: ' third' },
    ]);
});
