import type { SessionDetails } from 'electron/src/types/sessions';
import type { RendererAdapter } from './rendererAdapter';
import { autorun } from 'mobx';
import { describe, expect, it, vi } from 'vitest';
import { AppStore } from './appStore';
import { createFakeRendererAdapter } from './testing/fakeRendererAdapter';

const session = (id: string): SessionDetails => ({
    id, title: id, createdAt: 1, updatedAt: 1, sourceKind: 'imported', hasTranscript: false,
    audioOriginalPath: `/${id}.wav`, audioWavPath: `/${id}.wav`,
});

const setup = () => {
    let finishDownload: () => void = () => undefined;
    let failDownload: (error: Error) => void = () => undefined;
    const download = vi.fn(() => new Promise<void>((resolve, reject) => {
        finishDownload = resolve;
        failDownload = reject;
    }));
    const transcribe = vi.fn<RendererAdapter['transcribe']>(() => Promise.resolve('Transcript'));
    const fake = createFakeRendererAdapter({
        downloadWhisperModel: download,
        transcribe,
        getSession: (id) => Promise.resolve(session(id)),
        getWhisperModels: () => Promise.resolve([{ name: 'large', sizeLabel: '3 GB', isBundled: false, isDownloaded: true }]),
    });
    const store = new AppStore(fake.adapter);
    store.workspace.replaceWorkspace(session('first'));

    return { store, fake, download, transcribe, finishDownload: () => finishDownload(), failDownload: () => failDownload(new Error('Download failed')) };
};

describe('Transcription preparation integration', () => {
    it('continues once using the latest settings and workspace without MobX action warnings', async () => {
        const { store, download, transcribe, finishDownload } = setup();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const unsubscribe = autorun(() => {
            void store.transcriptionControl.pendingDownloadModel;
            void store.transcriptionControl.isDownloadingPendingModel;
        });
        try {
            await store.requestTranscriptionStart();
            const completion = store.confirmPendingTranscriptionDownload();
            expect((await store.confirmPendingTranscriptionDownload()).ok).toBe(false);
            await store.openSession('second');
            store.transcriptionControl.setLanguage('en');
            store.transcriptionControl.setMaxLen(64);
            finishDownload();
            expect((await completion).ok).toBe(true);
            expect(download).toHaveBeenCalledOnce();
            expect(transcribe).toHaveBeenCalledOnce();
            expect(transcribe).toHaveBeenCalledWith('/second.wav', expect.objectContaining({ language: 'en', maxLen: 64, sessionId: 'second' }));
            expect(warn).not.toHaveBeenCalled();
        } finally {
            unsubscribe();
        }
    });

    it('downloads a selected model without starting transcription', async () => {
        const { store, transcribe, finishDownload } = setup();
        const download = store.downloadWhisperModel('large');
        finishDownload();
        expect((await download).ok).toBe(true);
        expect(transcribe).not.toHaveBeenCalled();
        expect(store.transcriptionControl.pendingDownloadModel).toBeNull();
    });

    it.each(['cancel', 'clear', 'dispose'] as const)('does not auto-start after %s', async (action) => {
        const { store, transcribe, finishDownload } = setup();
        if (action === 'dispose') store.initialize();
        await store.requestTranscriptionStart();
        const completion = store.confirmPendingTranscriptionDownload();
        if (action === 'cancel') store.transcriptionControl.cancelPendingDownload();
        if (action === 'clear') store.clearWorkspace();
        if (action === 'dispose') { store.dispose(); store.initialize(); }
        finishDownload();
        await completion;
        expect(transcribe).not.toHaveBeenCalled();
        expect(store.transcriptionControl.pendingDownloadModel).toBeNull();
        if (action === 'dispose') store.dispose();
    });

    it('returns a safe failure without auto-starting after a rejected download', async () => {
        const { store, transcribe, failDownload } = setup();
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await store.requestTranscriptionStart();
        const completion = store.confirmPendingTranscriptionDownload();
        failDownload();
        expect((await completion).ok).toBe(false);
        expect(transcribe).not.toHaveBeenCalled();
        expect(store.transcriptionControl.pendingDownloadModel).toBeNull();
    });

    it('respects a workspace operation that starts while the model downloads', async () => {
        const { store, transcribe, finishDownload } = setup();
        await store.requestTranscriptionStart();
        const completion = store.confirmPendingTranscriptionDownload();
        const operation = store.operations.begin('recording')!;
        finishDownload();
        expect(await completion).toEqual({ ok: false, message: 'Another workspace operation is already running.' });
        expect(transcribe).not.toHaveBeenCalled();
        expect(store.operations.active).toEqual(operation);
        store.operations.finish(operation);
    });

    it('suppresses the obsolete button result after an intentional stop', async () => {
        let finish: (text: string) => void = () => undefined;
        const fake = createFakeRendererAdapter({
            transcribe: () => new Promise<string>((resolve) => { finish = resolve; }),
            stopTranscription: () => Promise.resolve(true),
        });
        const store = new AppStore(fake.adapter);
        store.workspace.replaceWorkspace(session('first'));
        store.transcriptionControl.setUseCustomModelFile(true);
        store.transcriptionControl.setCustomModelFile({ path: '/model.bin', fileName: 'model.bin' });
        const request = store.requestTranscriptionStart();
        expect((await store.stopTranscription()).ok).toBe(true);
        finish('Late output');
        expect((await request).ok).toBe(true);
        expect(store.transcription.runOutcome).toBe('stopped');
    });
});
