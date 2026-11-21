import type { SummaryModelStatus } from 'electron/src/types/summaryModel';
import { expect, it, vi } from 'vitest';
import { ForegroundOperationStore } from './foregroundOperationStore';
import { SummaryStore } from './summaryStore';
import { createFakeRendererAdapter } from './testing/fakeRendererAdapter';

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
