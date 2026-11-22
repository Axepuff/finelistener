export interface TranscriptMatchRange {
    segmentIndex: number;
    start: number;
    end: number;
}

export interface TranscriptMatch {
    ranges: TranscriptMatchRange[];
}

export const findTranscriptMatches = (segments: ReadonlyArray<{ text: string }>, query: string, separator = ' '): TranscriptMatch[] => {
    const searchText = query.trim();
    if (!searchText) return [];

    const pattern = new RegExp(searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let offset = 0;
    const segmentSpans = segments.map((segment, segmentIndex) => {
        const span = { segmentIndex, start: offset, end: offset + segment.text.length };
        offset = span.end + separator.length;
        return span;
    });
    const transcriptText = segments.map((segment) => segment.text).join(separator);

    let firstSpan = 0;
    return Array.from(transcriptText.matchAll(pattern), (match) => {
        const matchEnd = match.index + match[0].length;
        const ranges: TranscriptMatchRange[] = [];
        while (firstSpan < segmentSpans.length && segmentSpans[firstSpan].end <= match.index) firstSpan++;
        for (let i = firstSpan; i < segmentSpans.length && segmentSpans[i].start < matchEnd; i++) {
            const span = segmentSpans[i];
            const start = Math.max(span.start, match.index) - span.start;
            const end = Math.min(span.end, matchEnd) - span.start;
            if (start < end) ranges.push({ segmentIndex: span.segmentIndex, start, end });
        }

        return { ranges };
    });
};
