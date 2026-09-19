import type { WhisperModelDownloadProgress, WhisperModelInfo } from 'electron/src/types/whisper';
import { expect, expectTypeOf, it, vi } from 'vitest';
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

it('exposes model data and download progress as read-only values', () => {
    expectTypeOf<WhisperModelStore['models']>().toEqualTypeOf<readonly Readonly<WhisperModelInfo>[]>();
    expectTypeOf<WhisperModelStore['downloadProgress']>()
        .toEqualTypeOf<Readonly<WhisperModelDownloadProgress> | null>();
    expectTypeOf<ReturnType<WhisperModelStore['getModel']>>()
        .toEqualTypeOf<Readonly<WhisperModelInfo> | undefined>();
});

it('loads the catalog and reports download progress', async () => {
    const fake = createFakeRendererAdapter({ getWhisperModels: () => Promise.resolve([model]) });
    const store = new WhisperModelStore(fake.adapter);

    await expect(store.refresh()).resolves.toEqual({ ok: true, value: undefined });
    expect(store.models).toEqual([model]);

    store.updateDownloadProgress(progress);
    expect(store.downloadProgress).toEqual(progress);
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
