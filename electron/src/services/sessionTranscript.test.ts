import { expect, it } from 'vitest';
import type { SessionTranscriptV1 } from '../types/sessions';
import {
    createSpeakerMetadata, deriveSpeakerTranscript, materializeRecognitionTranscript, transcriptionResultToTranscript,
} from './sessionTranscript';

const recognition: SessionTranscriptV1 = {
    version: 1,
    segments: [{ startSec: 0, endSec: 2, text: 'Hello world.', words: [
        { startSec: 0, endSec: 0.8, text: 'Hello', startChar: 0, endChar: 5 },
        { startSec: 1, endSec: 1.8, text: 'world', startChar: 6, endChar: 11 },
    ] }],
};

it('falls back to completed text when structured segments are empty', () => {
    const transcript = transcriptionResultToTranscript({ text: '[00:00:00.000 --> 00:00:01.000] Speech',
        segments: [] }, 2);
    expect(transcript.recognitionSegments?.[0]).toMatchObject({ startSec: 2, endSec: 3, text: 'Speech' });
});

it('keeps a stable imported baseline and splits complete words without losing punctuation', () => {
    const transcript = materializeRecognitionTranscript(recognition);
    expect(materializeRecognitionTranscript(transcript).recognitionRevision).toBe(transcript.recognitionRevision);
    const intervals = [
        { startSec: 0, endSec: 0.9, speakerId: 'g:a' },
        { startSec: 0.9, endSec: 2, speakerId: 'g:b' },
    ];
    const speakers = createSpeakerMetadata(transcript, intervals, {}, 'g');
    const derived = deriveSpeakerTranscript({ ...transcript, speakers });
    expect(derived.segments.map((item) => [item.text, item.speakerId])).toEqual([
        ['Hello ', 'g:a'], ['world.', 'g:b'],
    ]);
    expect(derived.segments.map((item) => [item.startSec, item.endSec])).toEqual([
        [0, 0.8], [1, 1.8],
    ]);
    expect(derived.recognitionSegments?.[0].text).toBe('Hello world.');
    expect(deriveSpeakerTranscript(derived).segments).toEqual(derived.segments);
});

it('uses absolute word bounds for split rows in a selected import range', () => {
    const transcript = transcriptionResultToTranscript({ text: '', segments: [{
        startSec: 0, endSec: 3, text: 'one two three', words: [
            { startSec: 0.2, endSec: 0.6, text: 'one', startChar: 0, endChar: 3 },
            { startSec: 0.8, endSec: 1.3, text: 'two', startChar: 4, endChar: 7 },
            { startSec: 1.7, endSec: 2.1, text: 'three', startChar: 8, endChar: 13 },
        ],
    }] }, 12);
    const speakers = createSpeakerMetadata(transcript, [
        { startSec: 12, endSec: 13.5, speakerId: 'g:a' },
        { startSec: 13.5, endSec: 15, speakerId: 'g:b' },
    ], { range: { start: 12, end: 15 } }, 'g');
    const derived = deriveSpeakerTranscript({ ...transcript, speakers });
    expect(derived.segments.map((item) => ({ text: item.text, start: item.startSec,
        end: item.endSec, speaker: item.speakerId }))).toEqual([
        { text: 'one two ', start: 12.2, end: 13.3, speaker: 'g:a' },
        { text: 'three', start: 13.7, end: 14.1, speaker: 'g:b' },
    ]);
    expect(derived.segments.map((item) => item.text).join('')).toBe('one two three');
    expect(derived.recognitionSegments?.[0]).toMatchObject({ startSec: 12, endSec: 15 });
});

it('leaves overlapping, tied and invalid word timings unresolved', () => {
    const transcript = materializeRecognitionTranscript(recognition);
    const speakers = createSpeakerMetadata(transcript, [
        { startSec: 0, endSec: 1.5, speakerId: 'g:a' },
        { startSec: 0.2, endSec: 2, speakerId: 'g:b' },
    ], {}, 'g');
    expect(deriveSpeakerTranscript({ ...transcript, speakers }).segments[0].speakerId).toBeNull();

    const broken = materializeRecognitionTranscript({ version: 1, segments: [{
        startSec: 0, endSec: 2, text: 'Hello world.', words: [
            { startSec: Number.NaN, endSec: 0.8, text: 'Hello', startChar: 0, endChar: 5 },
        ],
    }] });
    const brokenSpeakers = createSpeakerMetadata(broken, [
        { startSec: 0, endSec: 1, speakerId: 'g:a' },
        { startSec: 1, endSec: 2, speakerId: 'g:b' },
    ], {}, 'g');
    expect(deriveSpeakerTranscript({ ...broken, speakers: brokenSpeakers }).segments).toMatchObject([
        { text: 'Hello world.', speakerId: null },
    ]);
});

it.each([
    { name: 'later speaker majority', spans: [[0, 2, 'a'], [2, 8, 'b']], expected: 'g:b' },
    { name: 'earlier speaker majority', spans: [[0, 6, 'a'], [6, 8, 'b']], expected: 'g:a' },
    { name: 'majority across separate turns', spans: [[0, 3, 'a'], [3, 5, 'b'], [5, 8, 'a']], expected: 'g:a' },
    { name: 'equal coverage', spans: [[0, 4, 'a'], [4, 8, 'b']], expected: null },
    { name: 'insufficient speech coverage', spans: [[0, 3, 'a']], expected: null },
    { name: 'short overlapping interruption', spans: [[0, 8, 'a'], [3.1, 3.2, 'b']], expected: null },
    { name: 'silent acoustic result', spans: [], expected: null },
])('assigns words by duration at touching interval boundaries: $name', ({ spans, expected }) => {
    const transcript = materializeRecognitionTranscript({ version: 1, segments: [{
        startSec: 0, endSec: 8, text: 'Hello', words: [
            { startSec: 0, endSec: 8, text: 'Hello', startChar: 0, endChar: 5 },
        ],
    }] });
    const speakers = createSpeakerMetadata(transcript, spans.map(([start, end, speaker]) => ({
        startSec: Number(start), endSec: Number(end), speakerId: `g:${speaker}`,
    })), {}, 'g');

    expect(deriveSpeakerTranscript({ ...transcript, speakers }).segments).toMatchObject([
        { text: 'Hello', startSec: 0, endSec: 8, speakerId: expected },
    ]);
});

it('keeps the whole segment when saved word spans are out of order', () => {
    const transcript = materializeRecognitionTranscript({ version: 1, segments: [{
        startSec: 0, endSec: 2, text: 'Hello world.', words: [
            { startSec: 1, endSec: 1.8, text: 'world', startChar: 6, endChar: 11 },
            { startSec: 0, endSec: 0.8, text: 'Hello', startChar: 0, endChar: 5 },
        ],
    }] });
    const speakers = createSpeakerMetadata(transcript, [
        { startSec: 0, endSec: 1, speakerId: 'g:a' },
        { startSec: 1, endSec: 2, speakerId: 'g:b' },
    ], {}, 'g');

    expect(deriveSpeakerTranscript({ ...transcript, speakers }).segments).toMatchObject([
        { text: 'Hello world.', speakerId: null },
    ]);
});

it('uses the fixed microphone identity and carries corrections through filtering and merges', () => {
    const phrase = 'a shared phrase with enough words for filtering';
    const transcript = materializeRecognitionTranscript({
        version: 1, segments: [], sourceRun: {
            status: 'completed', settings: { language: 'en' }, sources: [
                { source: 'system', status: 'completed', segments: [{ startSec: 0, endSec: 2, text: phrase }] },
                { source: 'microphone', status: 'completed', segments: [{
                    startSec: 0, endSec: 2, text: `${phrase} local reply`,
                }] },
            ],
        },
        presentation: { duplicateFilter: { enabled: true, status: 'applied', algorithm: 'cross-source-word-edit-v1',
            similarityThreshold: 0.8, minimumMatchingWords: 4, timeToleranceSec: 2.5 } },
    });
    const speakers = createSpeakerMetadata(transcript, [{ startSec: 0, endSec: 2, speakerId: 'g:a' }], {}, 'g');
    expect(speakers.speakers).toEqual([
        { id: 'g:microphone', name: 'Microphone speaker' },
        { id: 'g:a', name: 'Speaker 1' },
    ]);
    const microphone = transcript.sourceRun!.sources[1].segments[0];
    speakers.corrections.push({ segmentId: microphone.id!, startChar: 0, endChar: microphone.text.length,
        speakerId: 'g:microphone' });
    const visible = deriveSpeakerTranscript({ ...transcript, speakers });
    expect(visible.segments.filter((item) => item.source === 'microphone').map((item) => item.text))
        .toEqual(['local reply']);
    const visibleMicrophone = visible.segments.find((item) => item.source === 'microphone');
    expect(visibleMicrophone?.speakerId).toBe('g:microphone');
    expect(microphone.text.slice(visibleMicrophone!.rawSpan!.startChar,
        visibleMicrophone!.rawSpan!.endChar)).toBe('local reply');
    speakers.merges = [{ fromId: 'g:microphone', toId: 'g:a' }];
    const merged = deriveSpeakerTranscript({ ...transcript, speakers });
    expect(merged.segments.find((item) => item.source === 'microphone')?.speakerId).toBe('g:a');
    const unfiltered = deriveSpeakerTranscript({ ...transcript, speakers,
        presentation: { duplicateFilter: { ...transcript.presentation!.duplicateFilter!, enabled: false } } });
    expect(unfiltered.segments.find((item) => item.source === 'microphone')?.text).toBe(microphone.text);
    expect(unfiltered.segments.find((item) => item.source === 'microphone')?.speakerId).toBe('g:a');
});
