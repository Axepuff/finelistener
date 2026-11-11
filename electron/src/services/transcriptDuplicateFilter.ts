import type {
    RecordingSource,
    SessionSourceRun,
    SessionTranscriptSegmentV1,
    SessionTranscriptV1,
    TranscriptDuplicateFilterV1,
} from '../types/sessions';

export const TRANSCRIPT_DUPLICATE_FILTER_DEFAULTS = Object.freeze({
    algorithm: 'cross-source-word-edit-v1' as const,
    similarityThreshold: 0.8,
    minimumMatchingWords: 4,
    timeToleranceSec: 2.5,
});

const MAX_SEGMENTS_PER_CANDIDATE = 3;
const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
const NEGATIONS = new Set([
    'no', 'not', 'never', 'none', 'nothing', 'neither', 'nor',
    'не', 'нет', 'никогда', 'ничего', 'ни',
]);
const NUMBER_WORDS = new Set([
    'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
    'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
    'hundred', 'thousand', 'million',
    'ноль', 'один', 'одна', 'два', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь',
    'девять', 'десять', 'сто', 'тысяча', 'миллион',
]);

interface WordToken {
    normalized: string;
    original: string;
    segmentIndex: number;
    tokenIndex: number;
    start: number;
    end: number;
    segmentStartSec: number;
    segmentEndSec: number;
}

interface SegmentTokens {
    segment: SessionTranscriptSegmentV1;
    tokens: WordToken[];
}

interface CandidateGroup {
    tokens: WordToken[];
    startSec: number;
    endSec: number;
}

interface AlignmentStep {
    patternIndex?: number;
    textIndex?: number;
    equal: boolean;
}

interface Alignment {
    similarity: number;
    steps: AlignmentStep[];
}

interface DuplicateCandidate {
    similarity: number;
    timeDistance: number;
    microphoneTokens: WordToken[];
}

const normalizeWord = (value: string): string => value.normalize('NFKC').toLocaleLowerCase();

const tokenizeSegments = (segments: SessionTranscriptSegmentV1[]): SegmentTokens[] => segments.map((segment, segmentIndex) => {
    const tokens: WordToken[] = [];

    for (const match of segment.text.matchAll(WORD_PATTERN)) {
        const original = match[0];
        const start = match.index ?? 0;

        tokens.push({
            normalized: normalizeWord(original),
            original,
            segmentIndex,
            tokenIndex: tokens.length,
            start,
            end: start + original.length,
            segmentStartSec: segment.startSec,
            segmentEndSec: segment.endSec ?? segment.startSec,
        });
    }

    return { segment, tokens };
});

const createGroups = (segments: SegmentTokens[]): CandidateGroup[] => {
    const groups: CandidateGroup[] = [];

    for (let startIndex = 0; startIndex < segments.length; startIndex += 1) {
        const tokens: WordToken[] = [];
        let endSec = segments[startIndex].segment.endSec ?? segments[startIndex].segment.startSec;

        for (
            let endIndex = startIndex;
            endIndex < segments.length && endIndex < startIndex + MAX_SEGMENTS_PER_CANDIDATE;
            endIndex += 1
        ) {
            const current = segments[endIndex];

            if (endIndex > startIndex) {
                const gap = current.segment.startSec - endSec;

                if (gap > TRANSCRIPT_DUPLICATE_FILTER_DEFAULTS.timeToleranceSec) break;
            }

            tokens.push(...current.tokens);
            endSec = Math.max(endSec, current.segment.endSec ?? current.segment.startSec);

            if (tokens.length >= TRANSCRIPT_DUPLICATE_FILTER_DEFAULTS.minimumMatchingWords) {
                groups.push({
                    tokens: [...tokens],
                    startSec: segments[startIndex].segment.startSec,
                    endSec,
                });
            }
        }
    }

    return groups;
};

const intervalDistance = (left: CandidateGroup, right: CandidateGroup): number => {
    if (left.endSec < right.startSec) return right.startSec - left.endSec;
    if (right.endSec < left.startSec) return left.startSec - right.endSec;

    return 0;
};

const alignPatternToSubstring = (pattern: WordToken[], text: WordToken[]): Alignment => {
    const rows = pattern.length + 1;
    const columns = text.length + 1;
    const costs = Array.from({ length: rows }, () => Array<number>(columns).fill(0));
    const moves = Array.from({ length: rows }, () => Array<'diag' | 'up' | 'left' | null>(columns).fill(null));

    for (let row = 1; row < rows; row += 1) {
        costs[row][0] = row;
        moves[row][0] = 'up';
    }

    for (let row = 1; row < rows; row += 1) {
        for (let column = 1; column < columns; column += 1) {
            const substitution = costs[row - 1][column - 1] +
                (pattern[row - 1].normalized === text[column - 1].normalized ? 0 : 1);
            const deletion = costs[row - 1][column] + 1;
            const insertion = costs[row][column - 1] + 1;
            const best = Math.min(substitution, deletion, insertion);

            costs[row][column] = best;
            moves[row][column] = best === substitution ? 'diag' : best === deletion ? 'up' : 'left';
        }
    }

    let endColumn = 0;

    for (let column = 1; column < columns; column += 1) {
        if (costs[pattern.length][column] < costs[pattern.length][endColumn]) endColumn = column;
    }

    const steps: AlignmentStep[] = [];
    let row = pattern.length;
    let column = endColumn;

    while (row > 0) {
        const move = moves[row][column];

        if (move === 'diag') {
            steps.push({
                patternIndex: row - 1,
                textIndex: column - 1,
                equal: pattern[row - 1].normalized === text[column - 1].normalized,
            });
            row -= 1;
            column -= 1;
        } else if (move === 'up') {
            steps.push({ patternIndex: row - 1, equal: false });
            row -= 1;
        } else {
            steps.push({ textIndex: column - 1, equal: false });
            column -= 1;
        }
    }

    steps.reverse();
    const alignedTextLength = endColumn - column;
    const denominator = Math.max(pattern.length, alignedTextLength);

    return {
        similarity: denominator > 0 ? 1 - costs[pattern.length][endColumn] / denominator : 0,
        steps,
    };
};

const isProtectedDifference = (token: WordToken): boolean => {
    return NEGATIONS.has(token.normalized)
        || NUMBER_WORDS.has(token.normalized)
        || /\p{N}/u.test(token.original)
        || /^\p{Lu}/u.test(token.original);
};

const toCandidate = (
    alignment: Alignment,
    pattern: WordToken[],
    text: WordToken[],
    patternSource: RecordingSource,
): DuplicateCandidate | null => {
    if (alignment.similarity < TRANSCRIPT_DUPLICATE_FILTER_DEFAULTS.similarityThreshold) return null;

    const microphoneTokens: WordToken[] = [];
    let timeDistance = 0;

    for (const step of alignment.steps) {
        const patternToken = step.patternIndex === undefined ? undefined : pattern[step.patternIndex];
        const textToken = step.textIndex === undefined ? undefined : text[step.textIndex];

        if (!step.equal) {
            if ((patternToken && isProtectedDifference(patternToken)) || (textToken && isProtectedDifference(textToken))) {
                return null;
            }
            continue;
        }

        const microphoneToken = patternSource === 'microphone' ? patternToken : textToken;
        const systemToken = patternSource === 'system' ? patternToken : textToken;

        if (microphoneToken && systemToken) {
            const alignedDistance = systemToken.segmentEndSec < microphoneToken.segmentStartSec ?
                microphoneToken.segmentStartSec - systemToken.segmentEndSec :
                microphoneToken.segmentEndSec < systemToken.segmentStartSec ?
                    systemToken.segmentStartSec - microphoneToken.segmentEndSec :
                    0;

            if (alignedDistance > TRANSCRIPT_DUPLICATE_FILTER_DEFAULTS.timeToleranceSec) return null;
            timeDistance = Math.max(timeDistance, alignedDistance);
            microphoneTokens.push(microphoneToken);
        }
    }

    if (microphoneTokens.length < TRANSCRIPT_DUPLICATE_FILTER_DEFAULTS.minimumMatchingWords) return null;

    return { similarity: alignment.similarity, timeDistance, microphoneTokens };
};

const findCandidates = (systemGroups: CandidateGroup[], microphoneGroups: CandidateGroup[]): DuplicateCandidate[] => {
    const candidates: DuplicateCandidate[] = [];

    for (const microphone of microphoneGroups) {
        for (const system of systemGroups) {
            if (system.endSec < microphone.startSec - TRANSCRIPT_DUPLICATE_FILTER_DEFAULTS.timeToleranceSec) {
                continue;
            }
            if (system.startSec > microphone.endSec + TRANSCRIPT_DUPLICATE_FILTER_DEFAULTS.timeToleranceSec) {
                break;
            }
            const timeDistance = intervalDistance(microphone, system);

            if (timeDistance > TRANSCRIPT_DUPLICATE_FILTER_DEFAULTS.timeToleranceSec) continue;

            const systemPattern = toCandidate(
                alignPatternToSubstring(system.tokens, microphone.tokens),
                system.tokens,
                microphone.tokens,
                'system',
            );
            const microphonePattern = toCandidate(
                alignPatternToSubstring(microphone.tokens, system.tokens),
                microphone.tokens,
                system.tokens,
                'microphone',
            );
            const candidate = [systemPattern, microphonePattern]
                .filter((item): item is DuplicateCandidate => item !== null)
                .sort((left, right) => right.microphoneTokens.length - left.microphoneTokens.length
                    || right.similarity - left.similarity)[0];

            if (candidate) candidates.push(candidate);
        }
    }

    return candidates.sort((left, right) => right.microphoneTokens.length - left.microphoneTokens.length
        || right.similarity - left.similarity
        || left.timeDistance - right.timeDistance);
};

const retainedSpans = (segment: SegmentTokens, suppressed: Set<number>): SessionTranscriptSegmentV1[] => {
    const result: SessionTranscriptSegmentV1[] = [];
    let first = -1;
    for (let index = 0; index <= segment.tokens.length; index += 1) {
        if (index < segment.tokens.length && !suppressed.has(index)) {
            if (first < 0) first = index;
            continue;
        }
        if (first < 0) continue;
        const start = first === 0 ? 0 : segment.tokens[first].start;
        const next = segment.tokens[index];
        const end = next ? next.start : segment.segment.text.length;
        const raw = segment.segment.text.slice(start, end);
        const leading = raw.length - raw.trimStart().length;
        const trailing = raw.length - raw.trimEnd().length;
        const startChar = start + leading;
        const endChar = end - trailing;
        const text = segment.segment.text.slice(startChar, endChar);
        if (text) result.push({ ...segment.segment, text,
            ...(segment.segment.id ? { rawSpan: { segmentId: segment.segment.id, startChar, endChar } } : {}),
        });
        first = -1;
    }
    return result;
};

const createMetadata = (enabled: boolean, status: TranscriptDuplicateFilterV1['status']): TranscriptDuplicateFilterV1 => ({
    enabled,
    status,
    ...TRANSCRIPT_DUPLICATE_FILTER_DEFAULTS,
});

const mergeCompletedSegments = (run: SessionSourceRun): SessionTranscriptSegmentV1[] => run.sources
    .flatMap((source) => source.status === 'completed' ?
        source.segments.map((segment) => ({ ...segment, source: source.source,
            ...(segment.id ? { rawSpan: { segmentId: segment.id, startChar: 0, endChar: segment.text.length } } : {}),
        })) :
        [])
    .sort((left, right) => left.startSec - right.startSec);

export const deriveSourceTranscript = (run: SessionSourceRun, enabled: boolean): SessionTranscriptV1 => {
    const unfilteredSegments = mergeCompletedSegments(run);

    if (!enabled) {
        return {
            version: 1,
            segments: unfilteredSegments,
            sourceRun: run,
            presentation: { duplicateFilter: createMetadata(false, 'disabled') },
        };
    }

    try {
        const systemSegments = run.sources
            .filter((source) => source.source === 'system' && source.status === 'completed')
            .flatMap((source) => source.segments.map((segment) => ({ ...segment, source: 'system' as const,
                ...(segment.id ? { rawSpan: { segmentId: segment.id, startChar: 0, endChar: segment.text.length } } : {}),
            })));
        const microphoneSegments = run.sources
            .filter((source) => source.source === 'microphone' && source.status === 'completed')
            .flatMap((source) => source.segments.map((segment) => ({ ...segment, source: 'microphone' as const })));
        const tokenizedSystem = tokenizeSegments(systemSegments);
        const tokenizedMicrophone = tokenizeSegments(microphoneSegments);
        const candidates = findCandidates(createGroups(tokenizedSystem), createGroups(tokenizedMicrophone));
        const suppressedBySegment = new Map<number, Set<number>>();

        for (const candidate of candidates) {
            for (const token of candidate.microphoneTokens) {
                const suppressed = suppressedBySegment.get(token.segmentIndex) ?? new Set<number>();

                suppressed.add(token.tokenIndex);
                suppressedBySegment.set(token.segmentIndex, suppressed);
            }
        }

        const filteredMicrophone = tokenizedMicrophone.flatMap((segment, segmentIndex) => {
            const suppressed = suppressedBySegment.get(segmentIndex);

            if (!suppressed?.size) return [{ ...segment.segment,
                ...(segment.segment.id ? { rawSpan: { segmentId: segment.segment.id,
                    startChar: 0, endChar: segment.segment.text.length } } : {}),
            }];
            return retainedSpans(segment, suppressed);
        });
        const filteredSegments = [
            ...systemSegments,
            ...filteredMicrophone,
        ].sort((left, right) => left.startSec - right.startSec);

        return {
            version: 1,
            segments: filteredSegments,
            sourceRun: run,
            presentation: { duplicateFilter: createMetadata(true, 'applied') },
        };
    } catch (error: unknown) {
        console.error('Failed to filter transcript duplicate candidates', error);

        return {
            version: 1,
            segments: unfilteredSegments,
            sourceRun: run,
            presentation: { duplicateFilter: createMetadata(true, 'failed') },
        };
    }
};
