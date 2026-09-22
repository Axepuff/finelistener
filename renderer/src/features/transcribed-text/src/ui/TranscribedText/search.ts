export interface TranscriptMatch {
    segmentIndex: number;
    start: number;
    end: number;
}

export const findTranscriptMatches = (segments: ReadonlyArray<{ text: string }>, query: string): TranscriptMatch[] => {
    const searchText = query.trim();
    if (!searchText) return [];

    const pattern = new RegExp(searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');

    return segments.flatMap((segment, segmentIndex) =>
        Array.from(segment.text.matchAll(pattern), (match) => ({
            segmentIndex,
            start: match.index,
            end: match.index + match[0].length,
        })));
};
