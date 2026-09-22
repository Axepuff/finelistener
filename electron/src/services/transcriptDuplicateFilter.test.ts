import { describe, expect, it } from 'vitest';
import type { RecordingSource, SessionSourceRun, SessionTranscriptSegmentV1 } from '../types/sessions';
import { deriveSourceTranscript, TRANSCRIPT_DUPLICATE_FILTER_DEFAULTS } from './transcriptDuplicateFilter';

const segment = (
    source: RecordingSource,
    text: string,
    startSec: number,
    endSec: number | null = startSec + 1,
): SessionTranscriptSegmentV1 => ({ source, text, startSec, endSec });

const createRun = (
    systemSegments: SessionTranscriptSegmentV1[],
    microphoneSegments: SessionTranscriptSegmentV1[],
): SessionSourceRun => ({
    status: 'completed',
    settings: { language: 'en' },
    sources: [
        { source: 'system', status: 'completed', segments: systemSegments },
        { source: 'microphone', status: 'completed', segments: microphoneSegments },
    ],
});

const microphoneText = (run: SessionSourceRun): string[] => deriveSourceTranscript(run, true).segments
    .filter((item) => item.source === 'microphone')
    .map((item) => item.text);

describe('transcript duplicate filtering', () => {
    it('filters a long nearby phrase while retaining unchanged source results and metadata', () => {
        const run = createRun(
            [segment('system', 'This is a sufficiently long duplicated system phrase.', 10, 14)],
            [segment('microphone', 'this is a sufficiently long duplicated system phrase', 10.6, 14.5)],
        );
        const transcript = deriveSourceTranscript(run, true);

        expect(transcript.segments.filter((item) => item.source === 'microphone')).toEqual([]);
        expect(transcript.sourceRun?.sources[1].segments[0].text).toBe(
            'this is a sufficiently long duplicated system phrase',
        );
        expect(transcript.presentation?.duplicateFilter).toEqual({
            enabled: true,
            status: 'applied',
            ...TRANSCRIPT_DUPLICATE_FILTER_DEFAULTS,
        });
    });

    it('uses the 90 percent edit-similarity boundary conservatively', () => {
        const aboveBoundary = createRun(
            [segment('system', 'alpha bravo charlie delta echo foxtrot golf hotel india juliet', 0, 4)],
            [segment('microphone', 'alpha bravo charlie delta echo foxtrot golf hotel altered juliet', 0.2, 4.2)],
        );
        const belowBoundary = createRun(
            [segment('system', 'alpha bravo charlie delta echo foxtrot golf hotel india', 0, 4)],
            [segment('microphone', 'alpha bravo charlie delta echo foxtrot golf altered india', 0.2, 4.2)],
        );

        expect(microphoneText(aboveBoundary).join(' ')).toContain('altered');
        expect(microphoneText(aboveBoundary).join(' ')).not.toContain('alpha bravo charlie delta');
        expect(microphoneText(belowBoundary)).toEqual([
            'alpha bravo charlie delta echo foxtrot golf altered india',
        ]);
    });

    it('keeps identical phrases outside the time tolerance and short replies', () => {
        const farApart = createRun(
            [segment('system', 'a long phrase that should stay separate', 0, 2)],
            [segment('microphone', 'a long phrase that should stay separate', 10, 12)],
        );
        const shortReply = createRun(
            [segment('system', 'Yes', 1, 2)],
            [segment('microphone', 'yes', 1.1, 2.1)],
        );

        expect(microphoneText(farApart)).toEqual(['a long phrase that should stay separate']);
        expect(microphoneText(shortReply)).toEqual(['yes']);
    });

    it('uses the timing of the aligned segments instead of the full neighboring group', () => {
        const run = createRun(
            [
                segment('system', 'please send the signed contract today', 0, 1),
                segment('system', 'then discuss unrelated scheduling topics', 1, 3),
                segment('system', 'finally move on to another agenda item', 3, 5),
            ],
            [segment('microphone', 'please send the signed contract today', 7, 8)],
        );

        expect(microphoneText(run)).toEqual(['please send the signed contract today']);
    });

    it('preserves unique microphone speech around a matching span', () => {
        const run = createRun(
            [segment('system', 'the shared phrase contains enough words for matching', 5, 8)],
            [segment('microphone', 'My answer: the shared phrase contains enough words for matching, thanks.', 5.2, 8.3)],
        );

        expect(microphoneText(run)).toEqual(['My answer: thanks.']);
    });

    it.each([
        ['negation', 'we definitely should continue with the planned release today', 'we definitely should not continue with the planned release today'],
        ['number', 'please create exactly fifteen detailed reports for the customer today', 'please create exactly sixteen detailed reports for the customer today'],
        ['name', 'Please ask Alice to review the final detailed report today', 'Please ask Bob to review the final detailed report today'],
    ])('retains a similar phrase with a distinct %s', (_kind, systemText, microphoneTextValue) => {
        const run = createRun(
            [segment('system', systemText, 0, 5)],
            [segment('microphone', microphoneTextValue, 0.1, 5.1)],
        );

        expect(microphoneText(run)).toEqual([microphoneTextValue]);
    });

    it('matches across split segment boundaries and handles punctuation, case, and missing end times', () => {
        const run = createRun(
            [
                segment('system', 'A phrase split across', 2, null),
                segment('system', 'two source segments.', 3, 4),
            ],
            [segment('microphone', 'a PHRASE, split across two source segments', 2.3, null)],
        );

        expect(microphoneText(run)).toEqual([]);
    });

    it('returns the full deterministic representation when disabled or when a source is failed or silent', () => {
        const run = createRun(
            [segment('system', 'a long matching phrase with enough words', 0, 2)],
            [segment('microphone', 'a long matching phrase with enough words', 0, 2)],
        );
        const disabled = deriveSourceTranscript(run, false);
        const failedRun: SessionSourceRun = {
            ...run,
            status: 'incomplete',
            sources: [
                { source: 'system', status: 'completed', segments: [] },
                { source: 'microphone', status: 'failed', segments: [] },
            ],
        };

        expect(disabled.segments).toHaveLength(2);
        expect(disabled.presentation?.duplicateFilter?.status).toBe('disabled');
        expect(deriveSourceTranscript(failedRun, true).segments).toEqual([]);
        expect(deriveSourceTranscript(run, true)).toEqual(deriveSourceTranscript(run, true));
    });
});
