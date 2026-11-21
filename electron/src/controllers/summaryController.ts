import type { BrowserWindow, IpcMain } from 'electron';
import { generateLocalSummary, SUMMARY_MODEL } from '../services/localSummary';
import type { SessionsService } from '../services/SessionsService';
import type { SessionSummary, SummaryGenerationResult, SummaryProgressEvent } from '../types/sessions';
import {
    defaultRecordingSummaryOptions, isRecordingSummaryOptions, recordingSummaryGenerationVersion,
    sameRecordingSummaryOptions, type RecordingSummaryOptions,
} from '../types/summaryOptions';

export function registerSummaryController(
    ipc: IpcMain,
    getMainWindow: () => BrowserWindow | null,
    sessions: SessionsService,
    isUnavailable: () => boolean,
    requireInstalled: (signal: AbortSignal) => Promise<string>,
) {
    let active: { controller: AbortController; result: Promise<SummaryGenerationResult> } | null = null;

    const generate = async (sessionId: string, options: RecordingSummaryOptions, signal: AbortSignal): Promise<SummaryGenerationResult> => {
        try {
            const { rows, inputHash, saved, languageHint } = await sessions.readSummaryInput(sessionId);
            signal.throwIfAborted();
            const modelPath = await requireInstalled(signal);
            signal.throwIfAborted();
            const publish = (message: string, checkpoint?: SessionSummary): void => {
                const window = getMainWindow();
                if ((checkpoint || !signal.aborted) && window && !window.isDestroyed()) {
                    window.webContents.send('sessions:summary-progress', { sessionId, message, saved: checkpoint } satisfies SummaryProgressEvent);
                }
            };
            const provenance = { inputHash, model: SUMMARY_MODEL, generationVersion: recordingSummaryGenerationVersion, options };
            const canResume = saved?.generationVersion === recordingSummaryGenerationVersion && saved.model === SUMMARY_MODEL && !saved.brief
                && sameRecordingSummaryOptions(saved.options, options);
            let reviewedChunks = canResume ? saved.reviewedChunks : undefined;
            const summary = await generateLocalSummary(rows, modelPath, signal, publish, async (chunks) => {
                reviewedChunks = chunks;
                // Keep an existing complete result readable while a replacement brief is generated.
                if (saved?.brief) return;
                const checkpoint = await sessions.saveSummary(sessionId, {
                    reviewedChunks: chunks, detailed: chunks.map((item) => item.text).join('\n\n'),
                    brief: '', ...provenance,
                }, signal);
                publish('Writing the brief summary…', checkpoint);
            }, reviewedChunks, languageHint, options);
            signal.throwIfAborted();
            const completed = await sessions.saveSummary(sessionId, { ...summary, reviewedChunks, ...provenance }, signal);
            return { ok: true, summary: completed };
        } catch (error) {
            if (signal.aborted) return { ok: false, reason: 'cancelled' };
            if (error instanceof Error) {
                switch (error.message) {
                    case 'SUMMARY_MODEL_MISSING': return { ok: false, reason: 'model-missing' };
                    case 'SUMMARY_RUNTIME_UNAVAILABLE': return { ok: false, reason: 'runtime-unavailable' };
                    case 'SUMMARY_PROMPT_TOO_LONG': return { ok: false, reason: 'prompt-too-long' };
                    case 'The transcript changed during summarization.': return { ok: false, reason: 'transcript-changed' };
                    case 'Session has no transcript':
                    case 'A complete transcript with speech is required.': return { ok: false, reason: 'no-transcript' };
                }
            }
            console.error('Summary generation failed', error);
            return { ok: false, reason: 'failed' };
        }
    };

    const stopAndWait = async (): Promise<boolean> => {
        const operation = active;
        if (!operation) return false;
        operation.controller.abort();
        const result = await operation.result;
        return !result.ok && result.reason === 'cancelled';
    };

    ipc.handle('sessions:generate-summary', async (
        _event, sessionId: unknown, request: unknown = defaultRecordingSummaryOptions,
    ): Promise<SummaryGenerationResult> => {
        if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId !== sessionId.trim()) throw new Error('Invalid session id');
        if (isUnavailable() || active) return { ok: false, reason: 'busy' };
        if (!isRecordingSummaryOptions(request)) return { ok: false, reason: 'failed' };
        const { chunkCount, overlapPercent, prompt } = request;
        const controller = new AbortController();
        const result = generate(sessionId, { chunkCount, overlapPercent, prompt }, controller.signal).finally(() => { active = null; });
        active = { controller, result };
        return result;
    });
    ipc.handle('sessions:stop-summary', stopAndWait);
    return { get isBusy() { return active !== null; }, stopAndWait };
}
