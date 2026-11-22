import { describe, expect, it } from 'vitest';
import { TranscriptionControlStore } from './transcriptionControlStore';

describe('TranscriptionControlStore', () => {
    it('prepares downloaded and custom models with their configured options', () => {
        const store = new TranscriptionControlStore();
        expect(store.requestStart(true)).toMatchObject({ status: 'ready', options: { microphoneGateEnabled: true } });
        store.setMicrophoneGateEnabled(false);
        expect(store.requestStart(true)).toMatchObject({ status: 'ready', options: { microphoneGateEnabled: false } });
        store.setUseCustomModelFile(true);
        expect(store.requestStart(false).status).toBe('failed');
        store.setCustomModelFile({ path: '/models/custom.bin', fileName: 'custom.bin' });
        expect(store.requestStart(false)).toMatchObject({ status: 'ready', options: { modelPath: '/models/custom.bin' } });
    });

});
