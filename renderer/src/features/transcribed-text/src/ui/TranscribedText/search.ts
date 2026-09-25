export interface TranscriptMatchRange {
    segmentIndex: number;
    start: number;
    end: number;
}

export interface TranscriptMatch {
    ranges: TranscriptMatchRange[];
}

export const findTranscriptMatches = (segments: ReadonlyArray<{ text: string }>, query: string): TranscriptMatch[] => {
    const searchText = query.trim();
    if (!searchText) return [];

    const pattern = new RegExp(searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let offset = 0;
    const segmentSpans = segments.map((segment, segmentIndex) => {
        const span = { segmentIndex, start: offset, end: offset + segment.text.length };
        offset = span.end + 1;
        return span;
    });
    const transcriptText = segments.map((segment) => segment.text).join(' ');

    return Array.from(transcriptText.matchAll(pattern), (match) => {
        const matchEnd = match.index + match[0].length;
        const ranges = segmentSpans.flatMap((span) => {
            const start = Math.max(span.start, match.index) - span.start;
            const end = Math.min(span.end, matchEnd) - span.start;

            return start < end ? [{ segmentIndex: span.segmentIndex, start, end }] : [];
        });

        return { ranges };
    });
};
