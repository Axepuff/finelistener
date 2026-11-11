import { expect, it } from 'vitest';
import type { SessionTranscriptV1 } from 'electron/src/types/sessions';
import { projectTranscript, transcriptToHtml, transcriptToPlainText, transcriptToText } from './transcriptFormat';
import { findTranscriptMatches } from '../features/transcribed-text/src/ui/TranscribedText/search';

const transcript = (): SessionTranscriptV1 => ({
    version: 1, recognitionRevision: 'r',
    segments: [
        { id: 'a', startSec: 0, endSec: 1, text: 'Hello,', speakerId: 'a', source: 'system', rawSpan: { segmentId: 'a', startChar: 0, endChar: 6 } },
        { id: 'b', startSec: 6, endSec: 7, text: 'мир!', speakerId: 'a', source: 'system', rawSpan: { segmentId: 'b', startChar: 0, endChar: 4 } },
        { id: 'c', startSec: 7, endSec: 8, text: 'Next.', speakerId: 'a', source: 'system', rawSpan: { segmentId: 'c', startChar: 0, endChar: 5 } },
    ],
    speakers: { version: 1, recognitionRevision: 'r', generation: 'g', settings: {}, intervals: [],
        speakers: [{ id: 'a', name: 'Same name' }, { id: 'b', name: 'Same name' }], corrections: [], status: 'completed' },
});

it.each(['five seconds', 'long pause', 'A B A', 'unknown', 'different source', 'missing timing'])(
    'projects adjacent speaker turns across %s without rewriting raw members', (scenario) => {
        const input = transcript();
        if (scenario === 'long pause') input.segments[1].startSec = 6.001;
        if (scenario === 'A B A') input.segments[1].speakerId = 'b';
        if (scenario === 'unknown') input.segments[1].speakerId = null;
        if (scenario === 'different source') input.segments[1].source = 'microphone';
        if (scenario === 'missing timing') input.segments[0].endSec = null;
        const original = JSON.stringify(input);
        const rows = projectTranscript(input, 'speakers');
        expect(rows.length).toBe(scenario === 'five seconds' ? 1 : scenario === 'long pause' || scenario === 'missing timing' ? 2 : 3);
        expect(rows.flatMap((row) => row.members.map((member) => member.segment.id))).toEqual(['a', 'b', 'c']);
        expect(JSON.stringify(input)).toBe(original);
    },
);

it('shares speech, Unicode and mapped search offsets across view, clipboard and export', () => {
    const input = transcript();
    const rows = projectTranscript(input, 'speakers');
    expect(rows[0].text).toBe('Hello, мир! Next.');
    expect(rows[0].members.map((member) => [member.startChar, member.endChar])).toEqual([[0, 6], [7, 11], [12, 17]]);
    const matches = findTranscriptMatches(rows, 'мир! Next');
    expect(matches[0].ranges).toEqual([{ segmentIndex: 0, start: 7, end: 16 }]);
    expect(transcriptToPlainText(input)).toBe('Hello, мир! Next.');
    expect(transcriptToHtml(input, 'plain')).toBe('Hello, мир! Next.');
    expect(transcriptToText(input, 'speakers')).toBe('System audio · Same name: Hello, мир! Next.\n');
    expect(transcriptToHtml(input, 'speakers')).toBe('<p><strong>System audio · Same name: </strong>Hello, мир! Next.</p>\n');
    expect(rows[0].startSec).toBe(0);
    expect(rows[0].endSec).toBe(8);
    delete input.speakers;
    expect(projectTranscript(input, 'speakers')).toHaveLength(3);
    expect(transcriptToPlainText(null)).toBe('');
});

it('preserves subword joins within the same raw segment and regroups after identity edits', () => {
    const input = transcript();
    input.segments = [
        { startSec: 0, endSec: 1, text: 'Hel', speakerId: 'a', rawSpan: { segmentId: 'raw', startChar: 0, endChar: 3 } },
        { startSec: 1, endSec: 2, text: 'lo!', speakerId: 'b', rawSpan: { segmentId: 'raw', startChar: 3, endChar: 6 } },
    ];
    expect(transcriptToPlainText(input)).toBe('Hello!');
    expect(projectTranscript(input, 'speakers')).toHaveLength(2);
    expect(projectTranscript(input, 'timecodes').map((row) => row.text)).toEqual(['Hello!']);
    expect(transcriptToText(input)).toBe('[00:00:00 --> 00:00:02] Hello!\n');
    expect(transcriptToHtml(input)).toBe('<span data-regions="0.000">[00:00:00 - 00:00:02]</span> Hello!\n');
    input.segments[1].speakerId = 'a';
    expect(projectTranscript(input, 'speakers')[0].text).toBe('Hello!');
});

it('keeps recognition segments separate in Timecodes even when their speaker is the same', () => {
    const input = transcript();
    expect(projectTranscript(input, 'timecodes').map((row) => row.text)).toEqual(['Hello,', 'мир!', 'Next.']);
    expect(transcriptToText(input)).toBe(
        '[00:00:00 --> 00:00:01] System audio: Hello,\n' +
        '[00:00:06 --> 00:00:07] System audio: мир!\n' +
        '[00:00:07 --> 00:00:08] System audio: Next.\n',
    );
    expect(transcriptToHtml(input)).not.toContain('Same name');
});
