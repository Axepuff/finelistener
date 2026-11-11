import type { WhisperModelDownloadProgress, WhisperModelInfo } from 'electron/src/types/whisper';
import { expect, expectTypeOf, it, vi } from 'vitest';
import type { RendererAdapter } from './rendererAdapter';
import { WhisperModelStore } from './whisperModelStore';
import { createFakeRendererAdapter } from './testing/fakeRendererAdapter';

const model: WhisperModelInfo = {
    name: 'base',
    sizeLabel: '142 MB',
    isDownloaded: true,
    isBundled: false,
};

const progress: WhisperModelDownloadProgress = {
    name: 'base',
    percent: 50,
    downloadedBytes: 10,
    totalBytes: 20,
};

const createDeferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });

    return { promise, resolve, reject };
};

it('exposes model data and download progress as read-only values', () => {
    expectTypeOf<WhisperModelStore['models']>().toEqualTypeOf<readonly Readonly<WhisperModelInfo>[]>();
    expectTypeOf<WhisperModelStore['downloadProgress']>()
        .toEqualTypeOf<Readonly<WhisperModelDownloadProgress> | null>();
    expectTypeOf<ReturnType<WhisperModelStore['getModel']>>()
        .toEqualTypeOf<Readonly<WhisperModelInfo> | undefined>();
});

it('accepts progress only for its pending download and releases its listener', async () => {
    const pendingDownload = createDeferred<void>();
    const fake = createFakeRendererAdapter({
        getWhisperModels: () => Promise.resolve([model]),
        downloadWhisperModel: () => pendingDownload.promise,
    });
    const store = new WhisperModelStore(fake.adapter);
    store.initialize();
    store.initialize();

    expect(fake.activeListenerCount).toBe(1);
    fake.emitModelDownloadProgress(progress);
    expect(store.isDownloadActive).toBe(false);
    const download = store.download('base');
    fake.emitModelDownloadProgress(progress);
    expect(store.downloadProgress).toEqual(progress);
    fake.emitModelDownloadProgress({ ...progress, name: 'small' });
    expect(store.downloadProgress).toEqual(progress);
    pendingDownload.resolve();
    expect((await download).ok).toBe(true);
    expect(store.models).toEqual([model]);

    fake.emitModelDownloadProgress(progress);
    expect(store.isDownloadActive).toBe(false);
    store.dispose();
    store.dispose();
    expect(fake.activeListenerCount).toBe(0);
});

it('keeps downloaded availability when an older catalog response arrives last', async () => {
    const staleCatalog = createDeferred<WhisperModelInfo[]>();
    const getWhisperModels = vi.fn()
        .mockReturnValueOnce(staleCatalog.promise)
        .mockResolvedValue([model]);
    const fake = createFakeRendererAdapter({ getWhisperModels });
    const store = new WhisperModelStore(fake.adapter);
    const refresh = store.refresh();

    expect((await store.download('base')).ok).toBe(true);
    staleCatalog.resolve([{ ...model, isDownloaded: false }]);
    await refresh;

    expect(store.isDownloaded('base')).toBe(true);
});

it('rejects overlapping downloads without releasing the pending download', async () => {
    const pendingDownload = createDeferred<void>();
    const downloadWhisperModel = vi.fn(() => pendingDownload.promise);
    const fake = createFakeRendererAdapter({ downloadWhisperModel });
    const store = new WhisperModelStore(fake.adapter);
    const download = store.download('base');
    const secondDownload = store.download('small');

    expect(downloadWhisperModel).toHaveBeenCalledTimes(1);
    expect((await secondDownload).ok).toBe(false);
    expect(store.downloadProgress?.name).toBe('base');
    pendingDownload.resolve();
    expect((await download).ok).toBe(true);
    expect(store.isDownloadActive).toBe(false);
});

it.each(['resolve', 'reject'] as const)('ignores a catalog request that will %s after disposal and reinitialization', async (outcome) => {
    const staleCatalog = createDeferred<WhisperModelInfo[]>();
    const getWhisperModels = vi.fn()
        .mockReturnValueOnce(staleCatalog.promise)
        .mockResolvedValue([model]);
    const fake = createFakeRendererAdapter({ getWhisperModels });
    const store = new WhisperModelStore(fake.adapter);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const refresh = store.refresh();
    store.dispose();
    store.initialize();
    await Promise.resolve();

    if (outcome === 'resolve') staleCatalog.resolve([{ ...model, isDownloaded: false }]);
    else staleCatalog.reject(new Error('Obsolete catalog failure'));

    expect((await refresh).ok).toBe(false);
    expect(store.models).toEqual([model]);
    expect(errorSpy).not.toHaveBeenCalled();
    store.dispose();
});

it.each(['resolve', 'reject'] as const)('retains the pending download across reinitialization until it will %s', async (outcome) => {
    const pendingDownload = createDeferred<void>();
    const downloadWhisperModel = vi.fn()
        .mockReturnValueOnce(pendingDownload.promise)
        .mockResolvedValue(undefined);
    let modelDownloaded = false;
    const fake = createFakeRendererAdapter({
        downloadWhisperModel,
        getWhisperModels: () => Promise.resolve([{ ...model, isDownloaded: modelDownloaded }]),
    });
    const store = new WhisperModelStore(fake.adapter);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    store.initialize();
    const download = store.download('base');
    fake.emitModelDownloadProgress(progress);
    store.dispose();
    fake.emitModelDownloadProgress({ ...progress, percent: 75 });
    expect(store.downloadProgress?.percent).toBe(50);
    store.initialize();
    expect((await store.download('small')).ok).toBe(false);
    expect(downloadWhisperModel).toHaveBeenCalledTimes(1);
    fake.emitModelDownloadProgress({ ...progress, percent: 90 });
    expect(store.downloadProgress?.percent).toBe(90);

    if (outcome === 'resolve') {
        modelDownloaded = true;
        pendingDownload.resolve();
    } else {
        pendingDownload.reject(new Error('Download failed'));
    }

    expect((await download).ok).toBe(outcome === 'resolve');
    expect(store.isDownloaded('base')).toBe(outcome === 'resolve');
    expect(store.isDownloadActive).toBe(false);
    expect((await store.download('small')).ok).toBe(true);
    store.dispose();
});

it('does not refresh or publish a download result while disposed', async () => {
    const pendingDownload = createDeferred<void>();
    const getWhisperModels = vi.fn(() => Promise.resolve([model]));
    const fake = createFakeRendererAdapter({
        getWhisperModels,
        downloadWhisperModel: () => pendingDownload.promise,
    });
    const store = new WhisperModelStore(fake.adapter);
    const download = store.download('base');
    store.dispose();
    pendingDownload.resolve();

    expect((await download).ok).toBe(false);
    expect(getWhisperModels).not.toHaveBeenCalled();
    expect(store.models).toEqual([]);
    expect(store.isDownloadActive).toBe(false);
    store.initialize();
    await Promise.resolve();
    expect(store.isDownloaded('base')).toBe(true);
    store.dispose();
});

it('releases a completed download when the catalog refresh fails', async () => {
    const fake = createFakeRendererAdapter({
        getWhisperModels: () => Promise.reject(new Error('Catalog failed')),
    });
    const store = new WhisperModelStore(fake.adapter);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await store.download('base')).toEqual({ ok: false, message: 'Failed to load the available models.' });
    expect(store.isDownloadActive).toBe(false);
});

it.each(['resolve', 'reject'] as const)('rejects a custom import that will %s after reinitialization', async (outcome) => {
    const pendingImport = createDeferred<Awaited<ReturnType<RendererAdapter['importWhisperModelFromFile']>>>();
    const fake = createFakeRendererAdapter({ importWhisperModelFromFile: () => pendingImport.promise });
    const store = new WhisperModelStore(fake.adapter);
    const importing = store.importCustomModel();
    store.dispose();
    store.initialize();

    if (outcome === 'resolve') pendingImport.resolve({ ok: true, path: '/models/old.bin', fileName: 'old.bin' });
    else pendingImport.reject(new Error('Obsolete import failure'));

    expect(await importing).toEqual({ ok: false, message: 'Custom model import is no longer active.' });
    store.dispose();
});

it('imports a selected custom model', async () => {
    const fake = createFakeRendererAdapter({
        importWhisperModelFromFile: vi.fn(() => Promise.resolve({
            ok: true as const,
            path: '/models/custom.bin',
            fileName: 'custom.bin',
        })),
    });

    const result = await new WhisperModelStore(fake.adapter).importCustomModel();

    expect(result).toEqual({
        ok: true,
        value: { path: '/models/custom.bin', fileName: 'custom.bin' },
    });
});

it('returns success when custom model import is canceled', async () => {
    const fake = createFakeRendererAdapter({ importWhisperModelFromFile: () => Promise.resolve(null) });

    await expect(new WhisperModelStore(fake.adapter).importCustomModel()).resolves.toEqual({
        ok: true,
        value: null,
    });
});

it('returns a failure when the adapter rejects a custom model import', async () => {
    const fake = createFakeRendererAdapter({
        importWhisperModelFromFile: () => Promise.resolve({ ok: false as const, error: 'invalid model' }),
    });

    await expect(new WhisperModelStore(fake.adapter).importCustomModel()).resolves.toEqual({
        ok: false,
        message: 'Failed to import the model file.',
    });
});

it('converts a rejected custom model import into a command failure', async () => {
    const fake = createFakeRendererAdapter({
        importWhisperModelFromFile: () => Promise.reject(new Error('disk failure')),
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(new WhisperModelStore(fake.adapter).importCustomModel()).resolves.toEqual({
        ok: false,
        message: 'Failed to import the model file.',
    });

    errorSpy.mockRestore();
});
