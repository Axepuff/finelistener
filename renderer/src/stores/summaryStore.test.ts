import type { SummaryModelStatus } from 'electron/src/types/summaryModel';
import { expect, it, vi } from 'vitest';
import { ForegroundOperationStore } from './foregroundOperationStore';
import { SummaryStore } from './summaryStore';
import { AppStore } from './appStore';
import { createFakeRendererAdapter } from './testing/fakeRendererAdapter';

it.each(['enabled', 'unticked', 'unchecked', 'switched', 'busy', 'incomplete', 'failed'])(
    'scopes automatic generation to the opted-in session and verified download (%s)', async (mode) => {
        const download = Promise.withResolvers<SummaryModelStatus>();
        let notify!: (status: SummaryModelStatus) => void;
        const downloading: SummaryModelStatus = { state: 'downloading', model: 'Qwen', totalBytes: 100, downloadedBytes: 25 };
        const ready: SummaryModelStatus = { ...downloading, state: 'ready', downloadedBytes: 100 };
        const generate = vi.fn().mockResolvedValue({ ok: true, summary: { brief: 'Brief.', detailed: 'Notes.', inputHash: 'hash', model: 'Qwen' } });
        const { adapter } = createFakeRendererAdapter({
            getSession: (id) => Promise.resolve({ id, title: id, createdAt: 1, updatedAt: 1, sourceKind: 'imported',
                hasTranscript: true, audioMode: 'original', audioOriginalPath: 'a.wav', audioWavPath: 'a.wav',
                transcript: { version: 1, segments: [{ startSec: 0, endSec: 1, text: id }] } }),
            onSummaryModelChanged: (callback) => { notify = callback; return () => undefined; },
            downloadSummaryModel: () => { notify(downloading); return download.promise; }, generateSummary: generate,
        });
        const app = new AppStore(adapter);
        app.initialize();
        try {
            await app.openSession('first');
            const transfer = app.summary.downloadModel();
            if (mode !== 'unticked') app.summary.setGenerateAfterDownload('first', 'Initial prompt', true);
            app.summary.setPrompt('Latest prompt');
            if (mode === 'unchecked') app.summary.setGenerateAfterDownload('first', 'Latest prompt', false);
            if (mode === 'switched') await app.openSession('second');
            if (mode === 'busy') app.operations.begin('transcribing');
            if (mode === 'incomplete') app.transcription.replaceSavedTranscript(null);
            const terminal: SummaryModelStatus = mode === 'failed' ? { ...downloading, state: 'error', error: 'download' } : ready;
            notify(terminal);
            download.resolve(terminal);
            await transfer;
            if (mode === 'failed') { notify(downloading); notify(ready); }
            expect(generate).toHaveBeenCalledTimes(mode === 'enabled' ? 1 : 0);
            if (mode === 'enabled') expect(generate).toHaveBeenCalledWith('first', expect.objectContaining({ prompt: 'Latest prompt' }));
            expect(app.summary.automaticGenerationSession).toBeNull();
        } finally { app.dispose(); }
    });

it('keeps an explicit installation ready when an older availability check returns late', async () => {
    const ready: SummaryModelStatus = { model: 'Model', totalBytes: 20, downloadedBytes: 20, state: 'ready' };
    let respond!: (value: SummaryModelStatus) => void;
    const olderStatus = new Promise<SummaryModelStatus>((resolve) => { respond = resolve; });
    const generateSummary = vi.fn();
    const { adapter } = createFakeRendererAdapter({
        getSummaryModelStatus: () => olderStatus,
        downloadSummaryModel: () => Promise.resolve(ready),
        generateSummary,
    });
    const store = new SummaryStore(adapter, new ForegroundOperationStore());
    store.initialize();
    const refresh = store.refreshModelStatus();
    await store.downloadModel();
    respond({ ...ready, state: 'missing', downloadedBytes: 0 });
    await refresh;
    expect(store.modelStatus).toEqual(ready);
    expect(generateSummary).not.toHaveBeenCalled();
    store.dispose();
});
