import { summaryDraftProgressVersion, type SessionSummaryDraft } from './sessions';
import { isRecordingSummaryOptions, recordingSummaryGenerationVersion } from './summaryOptions';

export const SUMMARY_MODEL_ARTIFACT = {
    name: 'Qwen3-4B-Instruct-2507 Q4_K_M',
    fileName: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
    revision: 'a06e946bb6b655725eafa393f4a9745d460374c9',
    bytes: 2_497_281_120,
    sha256: '3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597',
} as const;

export function supportsSummaryDraft(
    draft: Pick<SessionSummaryDraft, 'model' | 'generationVersion' | 'options'> & { progress: { version: number } },
    model: string = SUMMARY_MODEL_ARTIFACT.name,
): boolean {
    return draft.model === model
        && draft.generationVersion === recordingSummaryGenerationVersion
        && draft.progress.version === summaryDraftProgressVersion
        && isRecordingSummaryOptions(draft.options);
}

export interface SummaryModelStatus {
    state: 'missing' | 'downloading' | 'ready' | 'cancelled' | 'error';
    model: string;
    totalBytes: number;
    downloadedBytes: number;
    error?: 'download' | 'disk-space' | 'storage';
}
