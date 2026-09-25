import type { SessionTranscriptV1 } from 'electron/src/types/sessions';
import type { TranscribeOpts } from 'electron/src/types/transcription';
import { describe, expect, it, vi } from 'vitest';
import type { RendererAdapter } from './rendererAdapter';
import { createFakeRendererAdapter } from './testing/fakeRendererAdapter';
import type { TranscriptionRunRequest } from './transcriptionStore';
import { TranscriptionStore } from './transcriptionStore';

const request: TranscriptionRunRequest = {
    audioPath: 'C:\\audio\\source.wav',
    sessionId: 'session-1',
    options: {
        language: 'en',
        model: 'base',
        splitOnWord: true,
        useVad: true,
    },
};

describe('TranscriptionStore', () => {
    it('accepts stream events only for its active run', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const resolvers: Array<(value: string) => void> = [];
        const rejecters: Array<(error: Error) => void> = [];
        const transcribe = vi.fn((_path: string, _options: TranscribeOpts) => new Promise<string>((resolve, reject) => {
            resolvers.push(resolve);
            rejecters.push(reject);
        }));
        const fake = createFakeRendererAdapter({ transcribe, stopTranscription: () => Promise.resolve(true) });
        const store = new TranscriptionStore(fake.adapter);

        store.initialize();
        try {
            const firstRun = store.start(request, () => true);
            const firstRunId = transcribe.mock.calls[0][1].runId;

            await store.stop(() => true);
            resolvers[0]('Discarded result');
            expect((await firstRun).status).toBe('replaced');

            const secondRun = store.start(request, () => true);
            const secondRunId = transcribe.mock.calls[1][1].runId;

            fake.emitTranscribeText({ runId: secondRunId, chunk: '[00:00:00.000 --> 00:00:01.000] Current draft\n' });
            fake.emitTranscribeProgress({ runId: secondRunId, value: 20 });
            fake.emitTranscribeText({ runId: firstRunId, chunk: '[00:00:01.000 --> 00:00:02.000] Old output\n' });
            fake.emitTranscribeProgress({ runId: firstRunId, value: 99 });

            expect(store.plainText).toBe('Current draft');
            expect(store.progress).toBe(20);

            rejecters[1](new Error('Second run failed'));
            expect((await secondRun).status).toBe('failed');
            expect(store.plainText).toBe('Current draft');
        } finally {
            store.dispose();
        }
    });

    it('keeps a saved transcript while a failed run leaves its draft visible', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const savedTranscript: SessionTranscriptV1 = {
            version: 1,
            segments: [{ startSec: 1, endSec: 2, text: 'Saved text' }],
        };
        let rejectTranscription: (error: Error) => void = () => undefined;
        const transcribe = vi.fn<RendererAdapter['transcribe']>(() => new Promise<string>((_resolve, reject) => {
            rejectTranscription = reject;
        }));
        const fake = createFakeRendererAdapter({ transcribe });
        const store = new TranscriptionStore(fake.adapter);

        store.replaceSavedTranscript(savedTranscript);
        store.initialize();
        try {
            const run = store.start(request, () => true);
            const runId = transcribe.mock.calls[0][1].runId;
            fake.emitTranscribeText({ runId, chunk: '[00:00:00.000 --> 00:00:01.000] Draft text\n' });

            rejectTranscription(new Error('Whisper crashed'));
            expect(await run).toEqual({ status: 'failed', message: 'Transcription failed.' });
            expect(store.savedTranscript).toEqual(savedTranscript);
            expect(store.draftTranscript?.segments[0]?.text).toBe('Draft text');
            expect(store.visibleTranscript?.segments[0]?.text).toBe('Draft text');
            expect(store.runOutcome).toBe('error');
        } finally {
            store.dispose();
        }
    });

    it('atomically promotes a successful draft to the saved transcript', async () => {
        let resolveTranscription: (value: string) => void = () => undefined;
        const transcribe = vi.fn<RendererAdapter['transcribe']>(() => new Promise<string>((resolve) => {
            resolveTranscription = resolve;
        }));
        const fake = createFakeRendererAdapter({ transcribe });
        const store = new TranscriptionStore(fake.adapter);

        store.initialize();
        try {
            const run = store.start(request, () => true);
            const runId = transcribe.mock.calls[0][1].runId;
            fake.emitTranscribeText({ runId, chunk: '[00:00:02.000 --> 00:00:03.000] Streaming text\n' });
            expect(store.draftTranscript?.segments[0]?.text).toBe('Streaming text');
            expect(store.savedTranscript).toBeNull();

            resolveTranscription('[00:00:02.000 --> 00:00:03.000] Final text\n');
            expect(await run).toEqual({ status: 'success' });
            expect(store.draftTranscript).toBeNull();
            expect(store.savedTranscript?.segments[0]?.text).toBe('Final text');
            expect(store.runOutcome).toBe('success');
        } finally {
            store.dispose();
        }
    });

    it('offsets segment transcript times and ignores completion after disposal', async () => {
        let resolveTranscription: (value: string) => void = () => undefined;
        const transcribe = vi.fn<RendererAdapter['transcribe']>(() => new Promise<string>((resolve) => {
            resolveTranscription = resolve;
        }));
        const fake = createFakeRendererAdapter({ transcribe });
        const store = new TranscriptionStore(fake.adapter);

        store.initialize();
        const run = store.start({ ...request, segment: { start: 12, end: 20 } }, () => true);
        const runId = transcribe.mock.calls[0][1].runId;
        fake.emitTranscribeText({ runId, chunk: '[00:00:00.000 --> 00:00:01.000] Draft text\n' });
        expect(store.draftTranscript?.segments[0]?.startSec).toBe(12);

        store.dispose();
        fake.emitTranscribeProgress({ runId, value: 50 });
        resolveTranscription('[00:00:00.000 --> 00:00:01.000] Late result\n');

        expect(await run).toEqual({ status: 'replaced' });
        expect(store.savedTranscript).toBeNull();
        expect(store.progress).toBe(0);
    });

    it.each(['success', 'error'] as const)(
        'keeps a new lifecycle run intact when an old run reports %s',
        async (completion) => {
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
            const resolvers: Array<(value: string) => void> = [];
            const rejecters: Array<(error: Error) => void> = [];
            const transcribe = vi.fn<RendererAdapter['transcribe']>(
                () => new Promise<string>((resolve, reject) => {
                    resolvers.push(resolve);
                    rejecters.push(reject);
                }),
            );
            const fake = createFakeRendererAdapter({ transcribe });
            const store = new TranscriptionStore(fake.adapter);

            store.initialize();
            const oldRun = store.start(request, () => true);
            const oldRunId = transcribe.mock.calls[0][1].runId;
            store.dispose();
            store.initialize();

            const newRun = store.start(request, () => true);
            const newRunId = transcribe.mock.calls[1][1].runId;
            fake.emitTranscribeText({ runId: newRunId, chunk: '[00:00:00.000 --> 00:00:01.000] New draft\n' });
            fake.emitTranscribeText({ runId: oldRunId, chunk: '[00:00:00.000 --> 00:00:01.000] Old draft\n' });

            if (completion === 'success') {
                resolvers[0]('[00:00:00.000 --> 00:00:01.000] Old result\n');
            } else {
                rejecters[0](new Error('Old error'));
            }

            expect(await oldRun).toEqual({ status: 'replaced' });
            expect(store.runOutcome).toBe('none');
            expect(store.draftTranscript?.segments[0]?.text).toBe('New draft');

            resolvers[1]('[00:00:00.000 --> 00:00:01.000] New result\n');
            expect(await newRun).toEqual({ status: 'success' });
            expect(store.plainText).toBe('New result');
            store.dispose();
        },
    );

    it('rejects a second direct start while its first run is active', async () => {
        let resolveTranscription: (value: string) => void = () => undefined;
        const transcribe = vi.fn<RendererAdapter['transcribe']>(() => new Promise<string>((resolve) => {
            resolveTranscription = resolve;
        }));
        const fake = createFakeRendererAdapter({ transcribe });
        const store = new TranscriptionStore(fake.adapter);

        store.initialize();
        const firstRun = store.start(request, () => true);

        expect(await store.start(request, () => true)).toEqual({
            status: 'failed',
            message: 'A transcription run is already active.',
        });
        expect(transcribe).toHaveBeenCalledOnce();

        resolveTranscription('[00:00:00.000 --> 00:00:01.000] First result\n');
        expect(await firstRun).toEqual({ status: 'success' });
        store.dispose();
    });

    it('registers one listener pair for each lifecycle', () => {
        const fake = createFakeRendererAdapter();
        const store = new TranscriptionStore(fake.adapter);

        store.initialize();
        store.initialize();
        expect(fake.activeListenerCount).toBe(2);

        store.dispose();
        store.dispose();
        expect(fake.activeListenerCount).toBe(0);

        store.initialize();
        expect(fake.activeListenerCount).toBe(2);
        store.dispose();
    });
});
