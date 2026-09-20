import type { RecordingState } from 'electron/src/services/RecordingService';
import type { SessionDetails } from 'electron/src/types/sessions';
import type { TranscribeOpts } from 'electron/src/types/transcription';
import { describe, expect, it, vi } from 'vitest';
import { AppStore } from './appStore';
import type { RendererAdapter } from './rendererAdapter';
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

        expect(fake.activeListenerCount).toBe(9);

        store.dispose();
        store.dispose();

        expect(fake.activeListenerCount).toBe(0);

        store.initialize();
        expect(fake.activeListenerCount).toBe(9);

        store.dispose();
    });

    it('ignores a stale transcription completion after the run is stopped', async () => {
        let resolveTranscription: (value: string) => void = () => undefined;
        const transcribe = vi.fn<RendererAdapter['transcribe']>(() => new Promise<string>((resolve) => {
            resolveTranscription = resolve;
        }));
        const fake = createFakeRendererAdapter({
            getSession: () => Promise.resolve(createSession()),
            transcribe,
            stopTranscription: () => Promise.resolve(true),
        });
        const store = new AppStore(fake.adapter);

        store.initialize();
        await store.openSession('session-1');
        const runPromise = store.startTranscription(transcriptionOptions);
        const runId = transcribe.mock.calls[0][1].runId;

        fake.emitTranscribeText({ runId, chunk: '[00:00:00.000 --> 00:00:01.000] Partial text\n' });
        await store.stopTranscription();
        resolveTranscription('[00:00:00.000 --> 00:00:01.000] Stale final text\n');
        expect(await runPromise).toEqual({ ok: false, message: 'The transcription run is no longer active.' });

        expect(store.transcription.runOutcome).toBe('stopped');
        expect(store.transcriptionWorkflow.outcome).toBe('stopped');
        expect(store.transcription.savedTranscript).toBeNull();
        expect(store.transcription.draftTranscript?.segments[0]?.text).toBe('Partial text');

        store.dispose();
    });

    it('ignores a delayed stop response after another transcription starts', async () => {
        let resolveTranscription: (value: string) => void = () => undefined;
        let resolveStop: (value: boolean) => void = () => undefined;
        const transcribe = vi.fn<RendererAdapter['transcribe']>(() => new Promise<string>((resolve) => {
            resolveTranscription = resolve;
        }));
        const fake = createFakeRendererAdapter({
            getSession: () => Promise.resolve(createSession()),
            transcribe,
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
            const secondRunId = transcribe.mock.calls[1][1].runId;

            fake.emitTranscribeText({ runId: secondRunId, chunk: '[00:00:00.000 --> 00:00:01.000] Second draft\n' });
            resolveStop(true);
            expect(await stopPromise).toEqual({ ok: false, message: 'The transcription run is no longer active.' });

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

    it('does not let a stopped run release the next foreground operation', async () => {
        const resolvers: Array<(value: string) => void> = [];
        const transcribe = vi.fn<RendererAdapter['transcribe']>(
            () => new Promise<string>((resolve) => {
                resolvers.push(resolve);
            }),
        );
        const fake = createFakeRendererAdapter({ transcribe, stopTranscription: () => Promise.resolve(true) });
        const store = new AppStore(fake.adapter);

        store.workspace.replaceWorkspace(createSession());
        const firstRun = store.startTranscription(transcriptionOptions);
        await store.stopTranscription();

        const secondRun = store.startTranscription(transcriptionOptions);
        const secondOperation = store.operations.active;
        resolvers[0]('[00:00:00.000 --> 00:00:01.000] Old result\n');

        expect(await firstRun).toEqual({ ok: false, message: 'The transcription run is no longer active.' });
        expect(store.operations.active).toEqual(secondOperation);

        resolvers[1]('[00:00:00.000 --> 00:00:01.000] New result\n');
        expect((await secondRun).ok).toBe(true);
        expect(store.operations.isBusy).toBe(false);
    });

    it('refreshes the session list only after the current transcription succeeds', async () => {
        const listSessions = vi.fn(() => Promise.resolve([]));
        const fake = createFakeRendererAdapter({
            listSessions,
            transcribe: () => Promise.resolve('[00:00:00.000 --> 00:00:01.000] Final text\n'),
        });
        const store = new AppStore(fake.adapter);

        store.workspace.replaceWorkspace(createSession());
        const result = await store.startTranscription(transcriptionOptions);

        expect(result.ok).toBe(true);
        expect(store.transcription.savedTranscript?.segments[0]?.text).toBe('Final text');
        expect(listSessions).toHaveBeenCalledOnce();
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
