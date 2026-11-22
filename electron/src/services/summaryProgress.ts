import type { ReviewedSummaryChunk, SessionSummaryDraft, SummarySourceRow, SummaryDraftProgress } from '../types/sessions';
import { isRecordingSummaryOptions } from '../types/summaryOptions';

const wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });

export const sliceRow = (row: SummarySourceRow, start: number, end = row.text.length): SummarySourceRow => {
    if (!row.sourceRef) return { ...row, text: row.text.slice(start, end) };
    const sourcePosition = (offset: number): number => {
        const boundary = row.sourceOffsets?.findLast((item) => item.offset <= offset);
        return boundary ? boundary.sourceOffset + offset - boundary.offset : row.sourceRef!.startChar + offset;
    };
    return { ...row, text: row.text.slice(start, end),
        sourceRef: { ...row.sourceRef, startChar: sourcePosition(start), endChar: sourcePosition(end) },
        sourceOffsets: row.sourceOffsets?.filter((item) => item.offset > start && item.offset <= end)
            .map((item) => ({ ...item, offset: item.offset - start })),
    };
};

export const groupRows = (rows: SummarySourceRow[], requested: number): SummarySourceRow[][] => {
    if (requested <= 1) return [rows];
    if (requested > rows.length) {
        const turns = rows.map((row) => {
            const starts: number[] = [];
            for (const word of wordSegmenter.segment(row.text)) {
                if (word.isWordLike) starts.push(word.index);
            }
            return { row, starts, parts: 1 };
        });
        for (let count = turns.length; count < requested; count++) {
            let widest: typeof turns[number] | undefined;
            for (const turn of turns) {
                if (turn.parts < turn.starts.length && (!widest || turn.starts.length / turn.parts > widest.starts.length / widest.parts)) widest = turn;
            }
            if (!widest) break;
            widest.parts++;
        }
        return turns.flatMap(({ row, starts, parts }) => {
            let start = 0;
            return Array.from({ length: parts }, (_, index) => {
                const end = index === parts - 1 ? row.text.length : starts[Math.floor((index + 1) * starts.length / parts)];
                const group = [sliceRow(row, start, end)];
                start = end;
                return group;
            });
        });
    }
    const groups: SummarySourceRow[][] = [];
    let remainingSize = rows.reduce((total, row) => total + row.text.length, 0);
    let first = 0;
    for (let remaining = Math.min(requested, rows.length); remaining > 1; remaining--) {
        const target = remainingSize / remaining;
        let end = first + 1;
        let size = rows[first].text.length;
        // Prefer the nearest turn boundary and leave a turn for each remaining group.
        while (end <= rows.length - remaining && Math.abs(size + rows[end].text.length - target) <= Math.abs(size - target)) {
            size += rows[end++].text.length;
        }
        groups.push(rows.slice(first, end));
        first = end;
        remainingSize -= size;
    }
    groups.push(rows.slice(first));
    return groups;
};

export const passageMetadata = (passage: SummarySourceRow[]): Omit<ReviewedSummaryChunk, 'text'> => {
    const sourceRefs = passage.flatMap((row) => row.sourceRef ? [row.sourceRef] : []);
    const speakers = passage.flatMap((row) => row.speakerSnapshot ? [row.speakerSnapshot] : [])
        .filter((speaker, index, all) => all.findIndex((item) => item.id === speaker.id && item.name === speaker.name) === index);
    return { startSec: passage[0].startSec, endSec: Math.max(...passage.map((row) => row.endSec)),
        ...(sourceRefs.length ? { sourceRefs } : {}), ...(speakers.length ? { speakers } : {}) };
};

export const sliceGroup = (rows: SummarySourceRow[], start: number, end: number): SummarySourceRow[] => {
    let offset = 0;
    return rows.flatMap((row) => {
        const first = Math.max(0, start - offset);
        const last = Math.min(row.text.length, end - offset);
        offset += row.text.length;
        return last > first ? [sliceRow(row, first, last)] : [];
    });
};

// Validate coverage and provenance without tokenizer/inference calls, including split utterances.
export const validSummaryProgress = (
    rows: SummarySourceRow[], chunks: ReviewedSummaryChunk[], progress: SummaryDraftProgress, chunkCount: number,
): boolean => {
    if (!progress || progress.version !== 1 || !['chunks', 'brief'].includes(progress.phase)
        || !Array.isArray(progress.cursors) || !chunks.length || chunks.length !== progress.cursors.length) return false;
    const groups = groupRows(rows, chunkCount);
    const sizes = groups.map((group) => group.reduce((sum, row) => sum + row.text.length, 0));
    let groupIndex = 0;
    let offset = 0;
    for (const [index, cursor] of progress.cursors.entries()) {
        if (offset === sizes[groupIndex]) { groupIndex++; offset = 0; }
        if (groupIndex >= groups.length || !cursor || cursor.groupIndex !== groupIndex || cursor.startChar !== offset
            || !Number.isInteger(cursor.endChar) || cursor.endChar <= offset || cursor.endChar > sizes[groupIndex]) return false;
        const chunk = chunks[index];
        if (!chunk || typeof chunk.text !== 'string' || !chunk.text.trim()) return false;
        const expected = passageMetadata(sliceGroup(groups[groupIndex], offset, cursor.endChar));
        if (chunk.startSec !== expected.startSec || chunk.endSec !== expected.endSec
            || JSON.stringify(chunk.sourceRefs) !== JSON.stringify(expected.sourceRefs)
            || JSON.stringify(chunk.speakers) !== JSON.stringify(expected.speakers)) return false;
        offset = cursor.endChar;
    }
    const finished = groupIndex === groups.length - 1 && offset === sizes[groupIndex];
    return (progress.phase === 'brief') === finished;
};

export const validSummaryDraft = (draft: SessionSummaryDraft, rows: SummarySourceRow[]): boolean =>
    Boolean(draft && isRecordingSummaryOptions(draft.options) && Array.isArray(draft.reviewedChunks)
        && validSummaryProgress(rows, draft.reviewedChunks, draft.progress, draft.options.chunkCount)
        && draft.detailed === draft.reviewedChunks.map((chunk) => chunk.text).join('\n\n'));
