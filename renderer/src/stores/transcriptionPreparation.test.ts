import type { SessionDetails } from 'electron/src/types/sessions';
import type { RendererAdapter } from './rendererAdapter';
import { describe, expect, it, vi } from 'vitest';
import { AppStore } from './appStore';
import { createFakeRendererAdapter } from './testing/fakeRendererAdapter';

const session = (id: string): SessionDetails => ({
    id, title: id, createdAt: 1, updatedAt: 1, sourceKind: 'imported', hasTranscript: false,
    audioMode: 'original',
    audioOriginalPath: `/${id}.wav`, audioWavPath: `/${id}.wav`,
});

const setup = () => {
    let finishDownload: () => void = () => undefined;
    const download = vi.fn(() => new Promise<void>((resolve) => {
        finishDownload = resolve;
    }));
    const transcribe = vi.fn<RendererAdapter['transcribe']>(() => Promise.resolve('Transcript'));
    const fake = createFakeRendererAdapter({
        downloadWhisperModel: download,
        transcribe,
        getSession: (id) => Promise.resolve(session(id)),
        getWhisperModels: () => Promise.resolve([{ name: 'large', sizeLabel: '874 MB', isBundled: false, isDownloaded: true }]),
    });
    const store = new AppStore(fake.adapter);
    void store.speakers.setEnabled(false);
    store.workspace.replaceWorkspace(session('first'));

    return { store, fake, download, transcribe, finishDownload: () => finishDownload() };
};

describe('Transcription preparation integration', () => {
    it('transcribes with Base during a Large download and keeps Base selected after installation', async () => {
        const { promise, resolve } = Promise.withResolvers<void>();
        let installed = false;
        const { adapter } = createFakeRendererAdapter({
            getWhisperModels: () => Promise.resolve([
                { name: 'base', sizeLabel: '148 MB', isBundled: true, isDownloaded: true },
                { name: 'large', sizeLabel: '874 MB', isBundled: false, isDownloaded: installed },
            ]),
            downloadWhisperModel: async () => { await promise; installed = true; },
            getSession: (id) => Promise.resolve(session(id)),
        });
        const transcribe = vi.spyOn(adapter, 'transcribe').mockResolvedValue('Transcript');
        const store = new AppStore(adapter);
        await store.speakers.setEnabled(false);
        await store.whisperModels.refresh();
        store.workspace.replaceWorkspace(session('first'));
        const downloading = store.downloadWhisperModel('large');
        store.transcriptionControl.setModel('base');
        expect((await store.requestTranscriptionStart()).ok).toBe(true);
        expect(transcribe).toHaveBeenCalledWith('/first.wav', expect.objectContaining({ model: 'base' }));
        expect(store.whisperModels.isDownloadActive).toBe(true);
        resolve();
        await downloading;
        expect(store.whisperModels.isDownloaded('large')).toBe(true);
        expect(store.transcriptionControl.model).toBe('base');
    });

    it('blocks an absent model without downloading or queuing a start, then requires an explicit start after download', async () => {
        const { store, download, transcribe, finishDownload } = setup();
        expect(await store.requestTranscriptionStart()).toEqual({ ok: false, message: 'Download the selected model to transcribe.' });
        expect(download).not.toHaveBeenCalled();
        expect(transcribe).not.toHaveBeenCalled();
        const completion = store.downloadWhisperModel('large');
        await store.openSession('second');
        store.transcriptionControl.setLanguage('en');
        store.transcriptionControl.setMaxLen(64);
        finishDownload();
        expect((await completion).ok).toBe(true);
        expect(transcribe).not.toHaveBeenCalled();
        expect((await store.requestTranscriptionStart()).ok).toBe(true);
        expect(transcribe).toHaveBeenCalledOnce();
        expect(transcribe).toHaveBeenCalledWith('/second.wav', expect.objectContaining({ language: 'en', maxLen: 64, sessionId: 'second' }));
    });

    it('suppresses the obsolete button result after an intentional stop', async () => {
        let finish: (text: string) => void = () => undefined;
        const fake = createFakeRendererAdapter({
            transcribe: () => new Promise<string>((resolve) => { finish = resolve; }),
            stopTranscription: () => Promise.resolve(true),
        });
        const store = new AppStore(fake.adapter);
        void store.speakers.setEnabled(false);
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
