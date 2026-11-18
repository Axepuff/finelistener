import { expect, it } from 'vitest';
import type { SessionSpeakerInterval, SessionTranscriptSegmentV1, SessionTranscriptV1 } from 'electron/src/types/sessions';
import { projectSpeakerReading } from './speakerReading';

const word = (text: string, startChar: number, startSec: number, endSec: number) =>
    ({ text, startChar, endChar: startChar + text.length, startSec, endSec });

const sample = (segments: SessionTranscriptSegmentV1[], intervals: SessionSpeakerInterval[] = []): SessionTranscriptV1 => ({
    version: 1, recognitionRevision: 'r', segments,
    speakers: { version: 1, recognitionRevision: 'r', generation: 'g', status: 'completed', settings: {},
        speakers: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], corrections: [], intervals },
});

it('keeps only visible speech, exact punctuation and word times when split spans point into a source recording', () => {
    const raw = { id: 'raw', startSec: 0, endSec: 5, text: 'Oops… «Ну-да», ага!', words: [
        word('Oops', 0, 0, 0.5), word('Ну', 7, 1, 1.3), word('да', 10, 2, 2.2), word('ага', 15, 3, 3),
    ] };
    const input = sample([
        { text: '«Ну-', startSec: 1, endSec: 1.3, speakerId: 'a', rawSpan: { segmentId: 'raw', startChar: 6, endChar: 10 } },
        { text: 'да», ага!', startSec: 2, endSec: 4, speakerId: 'b', rawSpan: { segmentId: 'raw', startChar: 10, endChar: 19 } },
    ]);
    input.sourceRun = { status: 'completed', settings: { language: 'ru' },
        sources: [{ source: 'system', status: 'completed', segments: [raw] }] };
    const [paragraph] = projectSpeakerReading(input);
    expect(paragraph.text).toBe('«Ну-да», ага!');
    expect(paragraph.words.map((w) => [paragraph.text.slice(w.startChar, w.endChar), w.startSec, w.speakerId]))
        .toEqual([['Ну', 1, 'a'], ['да', 2, 'b'], ['ага', null, 'b']]);
});

it('uses actual simultaneous acoustic activity for estimated colors and respects saved and manual assignments', () => {
    const raw = { id: 'raw', startSec: 0, endSec: 8, text: 'one two three four', words: [
        word('one', 0, 1, 2), word('two', 4, 2, 3), word('three', 8, 3, 4), word('four', 14, 4, 5),
    ] };
    const input = sample([
        { ...raw, text: 'one ', speakerId: 'a', rawSpan: { segmentId: 'raw', startChar: 0, endChar: 4 } },
        { ...raw, text: 'two three four', speakerId: null, rawSpan: { segmentId: 'raw', startChar: 4, endChar: 18 } },
    ]);
    input.recognitionSegments = [raw];
    input.speakers!.provenance = { version: 1, engine: 'nemotron-3', modelRevision: 'm', runtimeRevision: 'r', audioMode: 'original',
        backend: 'cpu', device: 'cpu', preset: 'v3-offline', modelSha256: '', runtimeSha256: '', assignmentPolicy: 'exclusive-majority-v2',
        acousticIntervals: [{ startSec: 0, endSec: 4, speakerId: 'b' }, { startSec: 1, endSec: 4.5, speakerId: 'a' },
            { startSec: 4.5, endSec: 7, speakerId: 'b' }] };
    input.speakers!.corrections.push({ segmentId: 'raw', startChar: 8, endChar: 13, speakerId: null });
    const before = JSON.stringify(input);
    const [paragraph] = projectSpeakerReading(input);
    expect(paragraph.words.map((w) => [w.speakerId, w.overlap, w.estimated])).toEqual([
        ['a', true, false], ['b', true, true], [null, true, false], [null, false, false],
    ]);
    expect(JSON.stringify(input)).toBe(before);
});

it('compares the total activity of each voice when it stops and restarts within an overlapping word', () => {
    const input = sample([{ text: 'yes', startSec: 0, endSec: 1, words: [word('yes', 0, 0, 1)] }], [
        { speakerId: 'a', startSec: 0, endSec: 0.4 }, { speakerId: 'b', startSec: 0.2, endSec: 0.75 },
        { speakerId: 'a', startSec: 0.6, endSec: 1 },
    ]);
    expect(projectSpeakerReading(input)[0].words[0]).toMatchObject({ speakerId: 'a', overlap: true, estimated: true });
});

it('restricts voice activity to its recording track and respects merges of acoustic identities', () => {
    const first = { id: 'sys', source: 'system' as const, text: 'yes', startSec: 10, endSec: 12, words: [word('yes', 0, 10, 12)] };
    const second = { ...first, id: 'mic', source: 'microphone' as const };
    const input = sample([first, second], [
        { speakerId: 'b', startSec: 10, endSec: 12 }, { speakerId: 'old', startSec: 11, endSec: 30 },
    ]);
    input.speakers!.merges = [{ fromId: 'old', toId: 'a' }];
    input.sourceRun = { status: 'completed', settings: { language: 'en' },
        sources: [first, second].map((s) => ({ source: s.source, status: 'completed', segments: [s] })) };
    const [para] = projectSpeakerReading(input);
    expect(para.words.map((w) => [w.speakerId, w.overlap, w.estimated])).toEqual([['b', true, true], [null, false, false]]);
    input.speakers!.merges[0].toId = 'b';
    expect(projectSpeakerReading(input)[0].words[0]).toMatchObject({ speakerId: null, overlap: false });
});

it('keeps an overlapping word unresolved when its primary voice was merged into Unknown', () => {
    const input = sample([{ text: 'yes', speakerId: null, startSec: 0, endSec: 1, words: [word('yes', 0, 0, 1)] }], [
        { speakerId: 'removed', startSec: 0, endSec: 1 }, { speakerId: 'a', startSec: 0.7, endSec: 0.95 },
        { speakerId: 'b', startSec: 0.75, endSec: 1 },
    ]);
    input.speakers!.merges = [{ fromId: 'removed', toId: null }];
    expect(projectSpeakerReading(input)[0].words[0]).toMatchObject({ speakerId: null, overlap: true, estimated: false });
});

it('breaks long reading passages at sentence boundaries while keeping offsets and legacy untimed words intact', () => {
    const first = '«Есть слово». '.repeat(24) + 'Он сказал: «Да!» ';
    const second = 'Продолжим позже. '.repeat(12);
    const input = sample([{ text: first, startSec: 0, endSec: 25, speakerId: 'a' },
        { text: second, startSec: 25, endSec: null, speakerId: 'b' }]);
    const [p1, p2] = projectSpeakerReading(input);
    expect([p1.text, p2.text]).toEqual([first, second]);
    expect(p2.offset).toBe(first.length);
    expect(p2.words[0]).toMatchObject({ startChar: 0, endChar: 'Продолжим'.length, startSec: null, speakerId: 'b' });
});
