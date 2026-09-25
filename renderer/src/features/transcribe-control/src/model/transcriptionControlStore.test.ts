import { describe, expect, it } from 'vitest';
import { commandFailure, commandSuccess } from 'renderer/src/stores/types';
import { TranscriptionControlStore } from './transcriptionControlStore';

describe('TranscriptionControlStore', () => {
    it('prepares downloaded and custom models without a download intent', () => {
        const store = new TranscriptionControlStore();
        expect(store.requestStart(true)).toMatchObject({ status: 'ready', options: { microphoneGateEnabled: true } });
        store.setMicrophoneGateEnabled(false);
        expect(store.requestStart(true)).toMatchObject({ status: 'ready', options: { microphoneGateEnabled: false } });
        expect(store.pendingDownloadModel).toBeNull();
        store.setUseCustomModelFile(true);
        expect(store.requestStart(false).status).toBe('failed');
        store.setCustomModelFile({ path: '/models/custom.bin', fileName: 'custom.bin' });
        expect(store.requestStart(false)).toMatchObject({ status: 'ready', options: { modelPath: '/models/custom.bin' } });
    });

    it('confirms one pending intent and uses the latest settings', () => {
        const store = new TranscriptionControlStore();
        expect(store.requestStart(false).status).toBe('awaiting-download');
        expect(store.requestStart(false).status).toBe('awaiting-download');
        const intent = store.beginPendingDownload();
        expect(intent).not.toBeNull();
        expect(store.beginPendingDownload()).toBeNull();
        store.setLanguage('en');
        store.setMaxContext(512);
        const prepared = store.completePendingDownload(intent!, commandSuccess(undefined));
        expect(prepared).toMatchObject({ status: 'ready', options: { language: 'en', maxContext: 512 } });
        expect(store.completePendingDownload(intent!, commandSuccess(undefined))).toBeNull();
        expect(store.pendingDownloadModel).toBeNull();
    });

    it.each(['cancel', 'dispose'] as const)('invalidates a pending intent on %s without affecting its successor', (command) => {
        const store = new TranscriptionControlStore();
        store.requestStart(false);
        const old = store.beginPendingDownload()!;
        if (command === 'cancel') store.cancelPendingDownload();
        else store.dispose();
        store.requestStart(false);
        const current = store.beginPendingDownload()!;
        expect(store.completePendingDownload(old, commandSuccess(undefined))).toBeNull();
        expect(store.isDownloadingPendingModel).toBe(true);
        expect(store.completePendingDownload(current, commandSuccess(undefined))?.status).toBe('ready');
    });

    it('clears the pending intent on download failure', () => {
        const store = new TranscriptionControlStore();
        store.requestStart(false);
        const intent = store.beginPendingDownload()!;
        expect(store.completePendingDownload(intent, commandFailure('Download failed.'))).toEqual({
            status: 'failed', message: 'Download failed.',
        });
        expect(store.pendingDownloadModel).toBeNull();
        expect(store.isDownloadingPendingModel).toBe(false);
    });
});
