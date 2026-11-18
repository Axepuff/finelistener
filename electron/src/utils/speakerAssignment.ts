import type { SessionRecognitionWord, SessionSpeakerInterval, SessionTranscriptSegmentV1 } from '../types/sessions';

export const assignedSpeaker = (startSec: number, endSec: number, intervals: readonly SessionSpeakerInterval[]): string | null => {
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) return null;
    const boundaries = [startSec, endSec];
    for (const interval of intervals) {
        if (!Number.isFinite(interval.startSec) || !Number.isFinite(interval.endSec)
            || interval.endSec <= interval.startSec) continue;
        if (interval.startSec > startSec && interval.startSec < endSec) boundaries.push(interval.startSec);
        if (interval.endSec > startSec && interval.endSec < endSec) boundaries.push(interval.endSec);
    }
    boundaries.sort((a, b) => a - b);
    const coverage = new Map<string, number>();
    for (let index = 0; index < boundaries.length - 1; index += 1) {
        // Touching intervals add the same boundary twice; a shared endpoint is not overlapping speech.
        if (boundaries[index + 1] <= boundaries[index]) continue;
        const middle = (boundaries[index] + boundaries[index + 1]) / 2;
        const active = new Set(intervals.filter((item) => item.startSec <= middle && item.endSec >= middle)
            .map((item) => item.speakerId));
        // Ambiguous time casts no vote; a speaker must still own most of the full word alone.
        if (active.size > 1) continue;
        const id = [...active][0];
        if (id) coverage.set(id, (coverage.get(id) ?? 0) + boundaries[index + 1] - boundaries[index]);
    }
    // Decimal boundaries can round exact half coverage upward, especially late in a recording.
    const roundingTolerance = Number.EPSILON * Math.max(1, Math.abs(startSec), Math.abs(endSec)) * boundaries.length;
    const majority = [...coverage].filter(([, duration]) =>
        duration - (endSec - startSec) / 2 > roundingTolerance);
    return majority.length === 1 ? majority[0][0] : null;
};

export const fallbackSpeaker = (segment: Pick<SessionTranscriptSegmentV1, 'startSec' | 'endSec'>, intervals: readonly SessionSpeakerInterval[]): string | null => {
    if (segment.endSec === null || !Number.isFinite(segment.endSec)) return null;
    const ids = new Set(intervals.filter((item) => item.startSec < segment.endSec!
        && item.endSec > segment.startSec).map((item) => item.speakerId));
    return ids.size === 1 ? [...ids][0] : null;
};

export const completeWordTimings = (
    raw: Pick<SessionTranscriptSegmentV1, 'text' | 'startSec' | 'endSec'> & { words?: readonly SessionRecognitionWord[] },
    start = 0, end = raw.text.length,
) => {
    const validWords = raw.words?.filter((word) => word.startChar >= start && word.endChar <= end
        && word.endChar > word.startChar && raw.text.slice(word.startChar, word.endChar) === word.text
        && Number.isFinite(word.startSec) && Number.isFinite(word.endSec) && word.endSec > word.startSec
        && word.startSec >= raw.startSec - 0.05 && (raw.endSec === null || word.endSec <= raw.endSec + 0.05));
    const completeWords = [...raw.text.slice(start, end).matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)]
        .map((match) => ({ startChar: start + (match.index ?? 0),
            endChar: start + (match.index ?? 0) + match[0].length }));
    if (!validWords?.length || validWords.length !== completeWords.length
        || validWords.some((word, index) => word.startChar !== completeWords[index].startChar
            || word.endChar !== completeWords[index].endChar)) return undefined;
    return validWords;
};
