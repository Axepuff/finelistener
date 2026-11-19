import type { BrowserWindow, IpcMain } from 'electron';
import { generateLocalSummary, SUMMARY_MODEL } from '../services/localSummary';
import type { SessionsService } from '../services/SessionsService';
import type { SessionSummary, SummaryGenerationResult, SummaryProgressEvent } from '../types/sessions';

export function registerSummaryController(
    ipc: IpcMain,
    getMainWindow: () => BrowserWindow | null,
    sessions: SessionsService,
    isUnavailable: () => boolean,
    requireInstalled: (signal: AbortSignal) => Promise<string>,
) {
    let active: { controller: AbortController; result: Promise<SummaryGenerationResult> } | null = null;

    const generate = async (sessionId: string, signal: AbortSignal): Promise<SummaryGenerationResult> => {
        try {
            const { rows, inputHash, saved } = await sessions.readSummaryInput(sessionId);
            signal.throwIfAborted();
            const modelPath = await requireInstalled(signal);
            signal.throwIfAborted();
            const publish = (message: string, checkpoint?: SessionSummary): void => {
                const window = getMainWindow();
                if ((checkpoint || !signal.aborted) && window && !window.isDestroyed()) {
                    window.webContents.send('sessions:summary-progress', { sessionId, message, saved: checkpoint } satisfies SummaryProgressEvent);
                }
            };
            let reviewedChunks = saved?.model === SUMMARY_MODEL ? saved.reviewedChunks : undefined;
            const summary = await generateLocalSummary(rows, modelPath, signal, publish, async (chunks) => {
                reviewedChunks = chunks;
                // Keep an existing complete result readable while a replacement brief is generated.
                if (saved?.brief) return;
                const checkpoint = await sessions.saveSummary(sessionId, {
                    reviewedChunks: chunks, detailed: chunks.map((item) => item.text).join('\n\n'),
                    brief: '', inputHash, model: SUMMARY_MODEL,
                }, signal);
                publish('Writing the brief summary…', checkpoint);
            }, reviewedChunks);
            signal.throwIfAborted();
            const completed = await sessions.saveSummary(sessionId, { ...summary, reviewedChunks, inputHash, model: SUMMARY_MODEL }, signal);
            return { ok: true, summary: completed };
        } catch (error) {
            if (signal.aborted) return { ok: false, reason: 'cancelled' };
            if (error instanceof Error) {
                switch (error.message) {
                    case 'SUMMARY_MODEL_MISSING': return { ok: false, reason: 'model-missing' };
                    case 'SUMMARY_RUNTIME_UNAVAILABLE': return { ok: false, reason: 'runtime-unavailable' };
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

    ipc.handle('sessions:generate-summary', async (_event, sessionId: unknown): Promise<SummaryGenerationResult> => {
        if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId !== sessionId.trim()) throw new Error('Invalid session id');
        if (isUnavailable() || active) return { ok: false, reason: 'busy' };
        const controller = new AbortController();
        const result = generate(sessionId, controller.signal).finally(() => { active = null; });
        active = { controller, result };
        return result;
    });
    ipc.handle('sessions:stop-summary', stopAndWait);
    return { get isBusy() { return active !== null; }, stopAndWait };
}
