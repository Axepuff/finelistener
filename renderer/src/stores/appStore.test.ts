import type { RecordingState } from 'electron/src/services/RecordingService';
import type { SessionDetails, SessionTranscriptV1 } from 'electron/src/types/sessions';
import type { TranscribeOpts } from 'electron/src/types/transcription';
import { describe, expect, it, vi } from 'vitest';
import { AppStore } from './appStore';
import { createFakeRendererAdapter } from './testing/fakeRendererAdapter';

const createSession = (overrides: Partial<SessionDetails> = {}): SessionDetails => ({
    id: 'session-1',
    title: 'Session 1',
    createdAt: 1,
    updatedAt: 1,
    sourceKind: 'imported',
    hasTranscript: false,
    audioOriginalPath: 'C:\\audio\\source.mp3',
    audioWavPath: 'C:\\audio\\source.wav',
    ...overrides,
});

const transcriptionOptions = {
    language: 'en',
    model: 'base' as const,
    splitOnWord: true,
    useVad: true,
};

describe('AppStore', () => {
    it('ignores text and progress from a stopped run while the next run is active', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        let resolveTranscription: (value: string) => void = () => undefined;
        let rejectTranscription: (error: Error) => void = () => undefined;
        const transcribe = vi.fn((_path: string, _options: TranscribeOpts) => new Promise<string>((resolve, reject) => {
            resolveTranscription = resolve;
            rejectTranscription = reject;
        }));
        const fake = createFakeRendererAdapter({
            getSession: () => Promise.resolve(createSession()),
            transcribe,
            stopTranscription: () => Promise.resolve(true),
        });
        const store = new AppStore(fake.adapter);

        store.initialize();
        try {
            await store.openSession('session-1');
            const firstRun = store.startTranscription(transcriptionOptions);
            const firstRunId = transcribe.mock.calls[0][1].runId;

            await store.stopTranscription();
            resolveTranscription('Discarded result');
            await firstRun;

            const secondRun = store.startTranscription(transcriptionOptions);
            const secondRunId = transcribe.mock.calls[1][1].runId;

            fake.emitTranscribeText({ runId: secondRunId, chunk: '[00:00:00.000 --> 00:00:01.000] Current draft\n' });
            fake.emitTranscribeProgress({ runId: secondRunId, value: 20 });
            fake.emitTranscribeText({ runId: firstRunId, chunk: '[00:00:01.000 --> 00:00:02.000] Old output\n' });
            fake.emitTranscribeProgress({ runId: firstRunId, value: 99 });

            expect(store.transcription.plainText).toBe('Current draft');
            expect(store.transcription.progress).toBe(20);
            rejectTranscription(new Error('Second run failed'));
            await secondRun;
            expect(store.transcription.plainText).toBe('Current draft');
            expect(store.transcription.savedTranscript).toBeNull();
        } finally {
            store.dispose();
        }
    });

    it.each(['recording', 'idle'] as const)(
        'restores recording ownership after reinitialization when capture is %s',
        async (restoredState) => {
            let emitRecordingState: (state: RecordingState) => void = () => undefined;
            let resolveRecordingState: (state: RecordingState) => void = () => undefined;
            const getRecordingState = vi.fn<() => Promise<RecordingState>>()
                .mockResolvedValueOnce('recording')
                .mockImplementationOnce(() => new Promise((resolve) => {
                    resolveRecordingState = resolve;
                }));
            const recordedSession = createSession({ sourceKind: 'recorded' });
            const stopSystemRecording = vi.fn(() => {
                emitRecordingState('idle');

                return Promise.resolve({
                    filePath: 'C:\\audio\\recording.wav',
                    format: { sampleRateHz: 16000, channels: 1, codec: 'pcm_s16le', bitDepth: 16 },
                });
            });
            const fake = createFakeRendererAdapter({
                getRecordingState,
                onRecordingState: (callback) => {
                    emitRecordingState = callback;

                    return () => { emitRecordingState = () => undefined; };
                },
                stopSystemRecording,
                importRecording: () => Promise.resolve(recordedSession),
            });
            const store = new AppStore(fake.adapter);

            store.initialize();
            try {
                await Promise.resolve();
                const previousOperationId = store.operations.active?.id;

                expect(store.operations.kind).toBe('recording');
                store.dispose();
                store.initialize();

                expect(store.operations.kind).toBe('recording');
                expect(store.operations.active?.id).not.toBe(previousOperationId);
                expect((await store.importAudio()).ok).toBe(false);

                resolveRecordingState(restoredState);
                await Promise.resolve();

                if (restoredState === 'recording') {
                    expect((await store.recording.stopRecording()).ok).toBe(true);
                    expect(stopSystemRecording).toHaveBeenCalledOnce();
                    expect(store.workspace.activeSessionId).toBe(recordedSession.id);
                } else {
                    expect(stopSystemRecording).not.toHaveBeenCalled();
                }

                expect(store.recording.session.recordingState).toBe('idle');
                expect(store.operations.isBusy).toBe(false);
                expect((await store.importAudio()).ok).toBe(true);
            } finally {
                store.dispose();
            }
        },
    );

    it('releases the workspace after a stopped recording fails to import', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        let emitRecordingState: (state: RecordingState) => void = () => undefined;
        let rejectImport: (error: Error) => void = () => undefined;
        const importRecording = vi.fn(() => new Promise<SessionDetails>((_resolve, reject) => {
            rejectImport = reject;
        }));
        const fake = createFakeRendererAdapter({
            getRecordingState: () => Promise.resolve('recording'),
            onRecordingState: (callback) => {
                emitRecordingState = callback;

                return () => { emitRecordingState = () => undefined; };
            },
            stopSystemRecording: () => {
                emitRecordingState('idle');

                return Promise.resolve({
                    filePath: 'C:\\audio\\recording.wav',
                    format: { sampleRateHz: 16000, channels: 1, codec: 'pcm_s16le', bitDepth: 16 },
                    durationMs: 1000,
                });
            },
            importRecording,
            getSession: () => Promise.resolve(createSession()),
        });
        const store = new AppStore(fake.adapter);

        store.initialize();
        try {
            await Promise.resolve();
            const stopPromise = store.recording.stopRecording();

            await Promise.resolve();
            expect(importRecording).toHaveBeenCalledOnce();
            expect(store.recording.session.recordingState).toBe('idle');
            expect(store.operations.kind).toBe('processing-recording');
            expect((await store.openSession('session-1')).ok).toBe(false);

            rejectImport(new Error('Session import failed'));
            expect((await stopPromise).ok).toBe(false);
            expect(store.recording.session.isProcessingRecording).toBe(false);
            expect(store.operations.isBusy).toBe(false);
            expect((await store.openSession('session-1')).ok).toBe(true);
        } finally {
            store.dispose();
        }
    });

    it('keeps the workspace locked when stopping capture fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const importRecording = vi.fn();
        const stopSystemRecording = vi.fn(() => Promise.reject(new Error('Capture is still active')));
        const fake = createFakeRendererAdapter({
            getRecordingState: () => Promise.resolve('recording'),
            stopSystemRecording,
            importRecording,
        });
        const store = new AppStore(fake.adapter);

        store.initialize();
        try {
            await Promise.resolve();
            expect((await store.recording.stopRecording()).ok).toBe(false);
            expect(store.operations.kind).toBe('recording');
            expect(store.recording.session.isProcessingRecording).toBe(false);
            expect((await store.importAudio()).ok).toBe(false);
            expect(importRecording).not.toHaveBeenCalled();

            await store.recording.stopRecording();
            expect(stopSystemRecording).toHaveBeenCalledTimes(2);
        } finally {
            store.dispose();
        }
    });

    it('provides one idempotent lifecycle for renderer listeners', () => {
        const fake = createFakeRendererAdapter();
        const store = new AppStore(fake.adapter);

        store.initialize();
        store.initialize();

        expect(fake.activeListenerCount).toBe(8);

        store.dispose();
        store.dispose();

        expect(fake.activeListenerCount).toBe(0);

        store.initialize();
        expect(fake.activeListenerCount).toBe(8);

        store.dispose();
    });

    it('keeps a saved transcript while a failed run leaves its draft visible', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const savedTranscript: SessionTranscriptV1 = {
            version: 1,
            segments: [{ startSec: 1, endSec: 2, text: 'Saved text' }],
        };
        let rejectTranscription: (error: Error) => void = () => undefined;
        const transcribe = vi.fn(() => new Promise<string>((_resolve, reject) => {
            rejectTranscription = reject;
        }));
        const fake = createFakeRendererAdapter({
            getSession: () => Promise.resolve(createSession({ transcript: savedTranscript, hasTranscript: true })),
            transcribe,
        });
        const store = new AppStore(fake.adapter);

        store.initialize();
        await store.openSession('session-1');
        const runPromise = store.startTranscription(transcriptionOptions);

        fake.emitTranscribeText({ runId: 2, chunk: '[00:00:00.000 --> 00:00:01.000] Draft text\n' });
        rejectTranscription(new Error('whisper crashed'));
        const result = await runPromise;

        expect(result.ok).toBe(false);
        expect(store.transcription.savedTranscript).toEqual(savedTranscript);
        expect(store.transcription.draftTranscript?.segments[0]?.text).toBe('Draft text');
        expect(store.transcription.visibleTranscript?.segments[0]?.text).toBe('Draft text');
        expect(store.transcription.runOutcome).toBe('error');

        store.dispose();
    });

    it('atomically promotes a successful draft to the saved transcript', async () => {
        let resolveTranscription: (value: string) => void = () => undefined;
        const fake = createFakeRendererAdapter({
            getSession: () => Promise.resolve(createSession()),
            transcribe: () => new Promise<string>((resolve) => {
                resolveTranscription = resolve;
            }),
        });
        const store = new AppStore(fake.adapter);

        store.initialize();
        await store.openSession('session-1');
        const runPromise = store.startTranscription(transcriptionOptions);

        fake.emitTranscribeText({ runId: 2, chunk: '[00:00:02.000 --> 00:00:03.000] Streaming text\n' });
        expect(store.transcription.draftTranscript?.segments[0]?.text).toBe('Streaming text');
        expect(store.transcription.savedTranscript).toBeNull();

        resolveTranscription('[00:00:02.000 --> 00:00:03.000] Final text\n');
        const result = await runPromise;

        expect(result.ok).toBe(true);
        expect(store.transcription.draftTranscript).toBeNull();
        expect(store.transcription.savedTranscript?.segments[0]?.text).toBe('Final text');
        expect(store.transcription.runOutcome).toBe('success');

        store.dispose();
    });

    it('ignores a stale transcription completion after the run is stopped', async () => {
        let resolveTranscription: (value: string) => void = () => undefined;
        const fake = createFakeRendererAdapter({
            getSession: () => Promise.resolve(createSession()),
            transcribe: () => new Promise<string>((resolve) => {
                resolveTranscription = resolve;
            }),
            stopTranscription: () => Promise.resolve(true),
        });
        const store = new AppStore(fake.adapter);

        store.initialize();
        await store.openSession('session-1');
        const runPromise = store.startTranscription(transcriptionOptions);

        fake.emitTranscribeText({ runId: 2, chunk: '[00:00:00.000 --> 00:00:01.000] Partial text\n' });
        await store.stopTranscription();
        resolveTranscription('[00:00:00.000 --> 00:00:01.000] Stale final text\n');
        await runPromise;

        expect(store.transcription.runOutcome).toBe('stopped');
        expect(store.transcriptionWorkflow.outcome).toBe('stopped');
        expect(store.transcription.savedTranscript).toBeNull();
        expect(store.transcription.draftTranscript?.segments[0]?.text).toBe('Partial text');

        store.dispose();
    });

    it('ignores a delayed stop response after another transcription starts', async () => {
        let resolveTranscription: (value: string) => void = () => undefined;
        let resolveStop: (value: boolean) => void = () => undefined;
        const fake = createFakeRendererAdapter({
            getSession: () => Promise.resolve(createSession()),
            transcribe: () => new Promise<string>((resolve) => {
                resolveTranscription = resolve;
            }),
            stopTranscription: () => new Promise<boolean>((resolve) => {
                resolveStop = resolve;
            }),
        });
        const store = new AppStore(fake.adapter);

        store.initialize();
        try {
            await store.openSession('session-1');
            const firstRun = store.startTranscription(transcriptionOptions);
            const stopPromise = store.stopTranscription();

            resolveTranscription('[00:00:00.000 --> 00:00:01.000] First result\n');
            await firstRun;
            const secondRun = store.startTranscription(transcriptionOptions);
            const secondOperation = store.operations.active;

            fake.emitTranscribeText({ runId: 3, chunk: '[00:00:00.000 --> 00:00:01.000] Second draft\n' });
            resolveStop(true);
            await stopPromise;

            expect(store.operations.active).toEqual(secondOperation);
            expect(store.transcription.runOutcome).toBe('none');
            expect(store.transcription.draftTranscript?.segments[0]?.text).toBe('Second draft');

            resolveTranscription('[00:00:00.000 --> 00:00:01.000] Second result\n');
            expect((await secondRun).ok).toBe(true);
            expect(store.transcription.savedTranscript?.segments[0]?.text).toBe('Second result');
            expect(store.transcription.runOutcome).toBe('success');
            expect(store.operations.isBusy).toBe(false);
        } finally {
            store.dispose();
        }
    });

    it('rejects a conflicting foreground operation', async () => {
        let resolveImport: (session: SessionDetails | null) => void = () => undefined;
        const fake = createFakeRendererAdapter({
            importAudio: () => new Promise((resolve) => {
                resolveImport = resolve;
            }),
            getSession: () => Promise.resolve(createSession()),
        });
        const store = new AppStore(fake.adapter);
        const importPromise = store.importAudio();

        const openResult = await store.openSession('session-1');

        expect(openResult).toEqual({
            ok: false,
            message: 'Another workspace operation is already running.',
        });

        resolveImport(null);
        await importPromise;
    });

    it('normalizes segment boundaries and transcribes one active audio source', async () => {
        const transcribe = vi.fn((_audioPath: string, _options: TranscribeOpts) => Promise.resolve(
            '[00:00:00.000 --> 00:00:01.000] Text\n',
        ));
        const fake = createFakeRendererAdapter({
            getSession: () => Promise.resolve(createSession()),
            transcribe,
        });
        const store = new AppStore(fake.adapter);

        await store.openSession('session-1');
        store.workspace.setSegmentStart(-5);
        store.workspace.setSegmentEnd(4);
        await store.startTranscription(transcriptionOptions);

        expect(store.workspace.selectedSegment).toEqual({ start: 0, end: 4 });
        expect(transcribe).toHaveBeenCalledTimes(1);
        expect(transcribe).toHaveBeenCalledWith(
            'C:\\audio\\source.wav',
            expect.objectContaining({ segment: { start: 0, end: 4 } }),
        );
    });
});
