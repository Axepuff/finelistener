export interface RecordingSummaryOptions {
    prompt: string;
    chunkCount: number;
    overlapPercent: number;
}

export const maxSummaryChunkCount = 256;
export const maxSummaryOverlapPercent = 50;
export const maxSummaryPromptLength = 4000;
export const recordingSummaryGenerationVersion = 4;

export const defaultRecordingSummaryOptions: Readonly<RecordingSummaryOptions> = {
    prompt: 'Summarize what the speakers discuss. Preserve the main ideas, their context and any differences in viewpoint. Use only information supported by the transcript.',
    chunkCount: 0,
    overlapPercent: 10,
};

export const sameRecordingSummaryOptions = (saved: RecordingSummaryOptions | undefined, requested: RecordingSummaryOptions): boolean =>
    saved?.prompt === requested.prompt && saved.chunkCount === requested.chunkCount && saved.overlapPercent === requested.overlapPercent;

export const isRecordingSummaryOptions = (value: unknown): value is RecordingSummaryOptions => {
    if (!value || typeof value !== 'object') return false;
    const options = value as Partial<RecordingSummaryOptions>;
    return typeof options.prompt === 'string' && options.prompt.trim().length > 0 && options.prompt.length <= maxSummaryPromptLength
        && typeof options.chunkCount === 'number' && Number.isInteger(options.chunkCount) && options.chunkCount >= 0 && options.chunkCount <= maxSummaryChunkCount
        && typeof options.overlapPercent === 'number' && Number.isInteger(options.overlapPercent) && options.overlapPercent >= 0 && options.overlapPercent <= maxSummaryOverlapPercent;
};
