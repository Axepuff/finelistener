import { MantineProvider } from '@mantine/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TranscribedTextContent } from './TranscribedTextContent';
import { findTranscriptMatches } from './search';

const segments = [
    { text: 'Hello (world). Hello again.', prefix: '', startSeconds: 1, timecode: '[00:00:01]' },
    { text: 'Another hello.', prefix: '', startSeconds: 2, timecode: '[00:00:02]' },
];

describe('transcript search', () => {
    it('finds every literal match without case sensitivity', () => {
        expect(findTranscriptMatches(segments, 'HELLO')).toEqual([
            { ranges: [{ segmentIndex: 0, start: 0, end: 5 }] },
            { ranges: [{ segmentIndex: 0, start: 15, end: 20 }] },
            { ranges: [{ segmentIndex: 1, start: 8, end: 13 }] },
        ]);
        expect(findTranscriptMatches(segments, '(world).')).toEqual([
            { ranges: [{ segmentIndex: 0, start: 6, end: 14 }] },
        ]);
        expect(findTranscriptMatches(segments, '   ')).toEqual([]);
    });

    it.each([false, true])('searches speech across segments without counting source labels in timecode mode: %s', (showRegions) => {
        const sourceSegments = [
            { text: 'hello', prefix: 'Microphone: ', startSeconds: 1, timecode: '[00:00:01]' },
            { text: 'world', prefix: 'System audio: ', startSeconds: 2, timecode: '[00:00:02]' },
        ];
        expect(findTranscriptMatches(sourceSegments, 'microphone')).toEqual([]);

        const matches = findTranscriptMatches(sourceSegments, 'hello world');
        expect(matches).toEqual([{ ranges: [
            { segmentIndex: 0, start: 0, end: 5 },
            { segmentIndex: 1, start: 0, end: 5 },
        ] }]);

        const html = renderToStaticMarkup(createElement(MantineProvider, null,
            createElement(TranscribedTextContent, {
                showRegions,
                plainSegments: sourceSegments,
                matches,
                activeMatchIndex: 0,
                searchQuery: 'hello world',
                transcriptText: 'hello world',
                onRegionClick: () => {},
            })));

        expect(html.match(/<mark /g)).toHaveLength(2);
        expect(html.match(/data-active="true"/g)).toHaveLength(2);
        expect(html).toContain('Microphone: ');
        expect(html).toContain('System audio: ');
    });

    it.each([false, true])('highlights recognized text in timecode mode: %s', (showRegions) => {
        const matches = findTranscriptMatches(segments, 'hello');
        const html = renderToStaticMarkup(createElement(MantineProvider, null,
            createElement(TranscribedTextContent, {
                showRegions,
                plainSegments: segments,
                matches,
                activeMatchIndex: 1,
                searchQuery: 'hello',
                transcriptText: segments.map((segment) => segment.text).join(' '),
                onRegionClick: () => {},
            })));

        expect(html.match(/<mark /g)).toHaveLength(3);
        expect(html.match(/data-active="true"/g)).toHaveLength(1);
        expect(html).toContain('<mark');
        expect(html).toContain('data-regions="1"');
        expect(html.includes('[00:00:01]')).toBe(showRegions);
    });
});
