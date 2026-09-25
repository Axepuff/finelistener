import { MantineProvider } from '@mantine/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppContext } from '../AppContext';
import { TranscribedText } from '../features/transcribed-text/src/ui/TranscribedText/TranscribedText';
import type { RecordingState } from 'electron/src/services/RecordingService';
import type { FinalizeRecordingResult, StartRecordingResult } from 'electron/src/types/recordingArchive';
import type { SessionDetails, SessionTranscriptV1 } from 'electron/src/types/sessions';
import type { SessionTranscribeOpts } from 'electron/src/types/transcription';
import { describe, expect, it, vi } from 'vitest';
import { AppStore } from './appStore';
import { createFakeRendererAdapter } from './testing/fakeRendererAdapter';
import { TranscriptionStore } from './transcriptionStore';
import { deriveSourceTranscript } from '../../../electron/src/services/transcriptDuplicateFilter';
import {
    UI_PREFERENCE_DEFAULTS,
    type UiPreferenceKey,
    type UiPreferenceValueMap,
} from '../../../electron/src/types/uiPreferences';

const session: SessionDetails = {
    id: 'recorded', title: 'Recording', createdAt: 1, updatedAt: 1, sourceKind: 'recorded',
    hasTranscript: false, audioOriginalPath: 'mix.wav', audioWavPath: 'mix.wav',
    tracks: [
        { source: 'system', filePath: 'system.wav', startOffsetMs: 0 },
        { source: 'microphone', filePath: 'microphone.wav', startOffsetMs: 0 },
    ],
};
const options = { language: 'en', model: 'base' as const, splitOnWord: true, useVad: true };
const recordingStorageFullMessage = 'Recording storage is full. Recover or delete an unfinished recording before starting a new one.';
const partial: SessionTranscriptV1 = {
    version: 1,
    segments: [{ startSec: 2, endSec: 3, text: 'Saved speech', source: 'system' }],
    sourceRun: {
        status: 'incomplete', settings: { ...options, segment: { start: 2, end: 9 } },
        sources: [
            { source: 'system', status: 'completed', segments: [{ startSec: 2, endSec: 3, text: 'Saved speech', source: 'system' }] },
            { source: 'microphone', status: 'failed', segments: [] },
        ],
    },
};
const captured: FinalizeRecordingResult = {
    recordingId: 'capture', sessionId: session.id, sourceWarnings: [],
};

const settle = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };

describe('recording sources', () => {
    it('defaults both sources on, persists Off, rejects both Off, and accepts the finalized session', async () => {
        const startSystemRecording = vi.fn(() => Promise.resolve({
            recordingId: 'capture', startedAt: 1,
        }));
        const fake = createFakeRendererAdapter({ runtimePlatform: 'win32', isRecordingAvailable: () => Promise.resolve(true),
            startSystemRecording, stopSystemRecording: () => Promise.resolve(captured), getSession: () => Promise.resolve(session) });
        const persist = vi.spyOn(fake.adapter, 'setUiPreference');
        const store = new AppStore(fake.adapter);

        store.initialize();
        try {
            await settle();
            expect(store.recording.devices.systemDeviceId).toBe('');
            expect(store.recording.devices.microphoneDeviceId).toBe('');
            store.recording.selectSource('system', null);
            store.recording.selectSource('microphone', null);
            await settle();
            expect(persist).toHaveBeenCalledWith('recordingMicrophoneDevice', null);
            expect((await store.recording.startRecording()).ok).toBe(false);
            expect(startSystemRecording).not.toHaveBeenCalled();
            store.recording.selectSource('microphone', 'chosen-mic');
            expect((await store.recording.startRecording()).ok).toBe(true);
            expect(startSystemRecording).toHaveBeenCalledWith({ deviceId: undefined, sources: { system: null, microphone: 'chosen-mic' } });
            expect((await store.recording.stopRecording()).ok).toBe(true);
            expect(store.workspace.activeSession?.tracks).toEqual(session.tracks);
        } finally { store.dispose(); }
    });

    it('accepts automatic finish once and releases the workspace lock', async () => {
        let emitFinished: (result: FinalizeRecordingResult) => void = () => undefined;
        let emitState: (state: RecordingState) => void = () => undefined;
        const stopSystemRecording = vi.fn(() => Promise.resolve(captured));
        const fake = createFakeRendererAdapter({
            getRecordingState: () => Promise.resolve('recording'), stopSystemRecording,
            getSession: () => Promise.resolve(session),
            onRecordingFinished: (callback) => { emitFinished = callback; return () => undefined; },
            onRecordingState: (callback) => { emitState = callback; return () => undefined; },
        });
        const store = new AppStore(fake.adapter);

        store.initialize();
        try {
            await settle();
            emitFinished(captured);
            emitState('idle');
            emitFinished(captured);
            expect(stopSystemRecording).not.toHaveBeenCalled();
            await settle();
            expect(store.workspace.activeSessionId).toBe(session.id);
            expect(store.operations.isBusy).toBe(false);
        } finally { store.dispose(); }
    });

    it('explains the quota failure after starting and idle events, refreshes recovery, and releases the lock', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        let emitState: (state: RecordingState) => void = () => undefined;
        const listRecoverableRecordings = vi.fn(() => Promise.resolve([]));
        const fake = createFakeRendererAdapter({
            runtimePlatform: 'win32',
            isRecordingAvailable: () => Promise.resolve(true),
            onRecordingState: (callback) => { emitState = callback; return () => undefined; },
            listRecoverableRecordings,
            startSystemRecording: () => {
                emitState('starting');
                emitState('idle');
                return Promise.resolve({ error: 'recording-storage-full' });
            },
        });
        const store = new AppStore(fake.adapter);
        store.initialize();
        try {
            await settle();
            listRecoverableRecordings.mockClear();
            expect(await store.recording.startRecording()).toEqual({
                ok: false,
                message: recordingStorageFullMessage,
            });
            expect(listRecoverableRecordings).toHaveBeenCalledTimes(1);
            expect(store.operations.isBusy).toBe(false);
        } finally { store.dispose(); }
    });
    it('keeps the lock until the start reply and ignores a quota reply after disposal', async () => {
        let emitState: (state: RecordingState) => void = () => undefined;
        let resolveStart!: (result: StartRecordingResult) => void;
        const reply = new Promise<StartRecordingResult>((resolve) => { resolveStart = resolve; });
        const startSystemRecording = vi.fn(() => {
            emitState('starting');
            emitState('idle');
            return reply;
        });
        const listRecoverableRecordings = vi.fn(() => Promise.resolve([]));
        const fake = createFakeRendererAdapter({
            runtimePlatform: 'win32', isRecordingAvailable: () => Promise.resolve(true),
            onRecordingState: (callback) => { emitState = callback; return () => undefined; },
            startSystemRecording, listRecoverableRecordings,
        });
        const store = new AppStore(fake.adapter);
        store.initialize();
        try {
            await settle();
            listRecoverableRecordings.mockClear();
            const start = store.recording.startRecording();
            await settle();
            expect(startSystemRecording).toHaveBeenCalledTimes(1);
            expect(store.operations.isBusy).toBe(true);
            expect((await store.recording.startRecording()).ok).toBe(false);
            expect(startSystemRecording).toHaveBeenCalledTimes(1);
            store.dispose();
            resolveStart({ error: 'recording-storage-full' });
            await expect(start).resolves.toEqual({ ok: false, message: 'Recording was cancelled.' });
            expect(listRecoverableRecordings).not.toHaveBeenCalled();
            expect(store.operations.isBusy).toBe(false);
        } finally { store.dispose(); }
    });
});

describe('source transcription', () => {
    it('keeps source drafts separate with shared timestamps and preserves labels in exports', async () => {
        let finish: (value: SessionDetails) => void = () => undefined;
        const transcribeSession = vi.fn((_id: string, _opts: SessionTranscribeOpts) => new Promise<SessionDetails>((resolve) => { finish = resolve; }));
        const fake = createFakeRendererAdapter({ transcribeSession });
        const store = new TranscriptionStore(fake.adapter);

        store.initialize();
        try {
            const run = store.start({ audioPath: 'mix.wav', sessionId: session.id, sourceAware: true, segment: { start: 2, end: 9 }, options }, () => true);
            const runId = transcribeSession.mock.calls[0][1].runId;

            fake.emitTranscribeText({ runId, source: 'system', offsetSec: 2, chunk: '[00:00:01.000 --> 00:00:02.000] Hello\n' });
            fake.emitTranscribeText({ runId, source: 'microphone', offsetSec: 2, chunk: '[00:00:00.000 --> 00:00:01.000] Earlier\n' });
            expect(store.draftTranscript?.segments.map((segment) => [segment.startSec, segment.source])).toEqual([[2, 'microphone'], [3, 'system']]);
            expect(store.plainText).toBe('Microphone: Earlier\nSystem audio: Hello');
            expect(store.timecodedText).toContain('Microphone: Earlier');
            expect(store.renderedHtml).toContain('System audio: Hello');
            finish({ ...session, transcript: partial });
            expect((await run).status).toBe('incomplete');
            expect(store.isIncomplete).toBe(true);
            expect(store.draftTranscript).toBeNull();
            expect(store.plainText).toBe('System audio: Saved speech');
        } finally { store.dispose(); }
    });

    it('reopens incomplete metadata and retries the saved run despite a changed selection', async () => {
        const transcribeSession = vi.fn(() => Promise.resolve({ ...session, transcript: partial }));
        const fake = createFakeRendererAdapter({ getSession: () => Promise.resolve({ ...session, transcript: partial }), transcribeSession });
        const store = new AppStore(fake.adapter);

        store.initialize();
        try {
            await store.openSession(session.id);
            expect(store.transcription.isIncomplete).toBe(true);
            store.workspace.setSegmentStart(99);
            expect((await store.retryIncompleteTranscription()).ok).toBe(true);
            expect(transcribeSession).toHaveBeenCalledWith(session.id, expect.objectContaining({
                retryFailed: true, segment: { start: 2, end: 9 }, microphoneGateEnabled: false, ...options,
            }));
        } finally { store.dispose(); }
    });

    it('lets cancellation reload completed sources before late request resolution releases ownership', async () => {
        let finishRun: (value: SessionDetails) => void = () => undefined;
        let finishStop: (value: boolean) => void = () => undefined;
        const fake = createFakeRendererAdapter({
            transcribeSession: () => new Promise((resolve) => { finishRun = resolve; }),
            stopTranscription: () => new Promise((resolve) => { finishStop = resolve; }),
            getSession: () => Promise.resolve({ ...session, transcript: partial }),
        });
        const store = new AppStore(fake.adapter);

        store.workspace.replaceWorkspace(session);
        store.initialize();
        try {
            const run = store.startTranscription(options);
            const stop = store.stopTranscription();

            finishRun({ ...session, transcript: partial });
            await settle();
            expect(store.operations.kind).toBe('transcribing');
            finishStop(true);
            expect((await stop).ok).toBe(true);
            await run;
            expect(store.transcription.runOutcome).toBe('stopped');
            expect(store.transcription.isIncomplete).toBe(true);
            expect(store.transcription.plainText).toBe('System audio: Saved speech');
            expect(store.operations.isBusy).toBe(false);
        } finally { store.dispose(); }
    });
});


describe('failed source transcription status', () => {
    const failedTranscript: SessionTranscriptV1 = {
        version: 1, segments: [], sourceRun: {
            status: 'incomplete', settings: options,
            sources: [
                { source: 'system', status: 'failed', segments: [] },
                { source: 'microphone', status: 'failed', segments: [] },
            ],
        },
    };

    it('does not claim completed source results when both sources fail', () => {
        const store = new AppStore(null);

        store.workspace.replaceWorkspace(session);
        store.transcription.replaceSavedTranscript(failedTranscript);
        const html = renderToStaticMarkup(createElement(MantineProvider, null,
            createElement(AppContext.Provider, { value: store }, createElement(TranscribedText))));

        expect(html).not.toContain('Completed sources are saved.');
        expect(html).toContain('Transcription failed');
        expect(html).toContain('Retry remaining sources');
    });

    it('does not report finished or successful when both sources fail', async () => {
        const fake = createFakeRendererAdapter({
            transcribeSession: () => Promise.resolve({ ...session, transcript: failedTranscript }),
        });
        const store = new AppStore(fake.adapter);

        store.workspace.replaceWorkspace(session);
        const result = await store.startTranscription(options);

        expect(store.activityLog.content).not.toContain('Whisper transcription finished');
        expect(result.ok).toBe(false);
        expect(store.transcription.isIncomplete).toBe(true);
    });
});


it.each([false, true])('keeps a completed empty source successful when another source fails: %s', async (otherFailed) => {
    const transcript: SessionTranscriptV1 = {
        version: 1, segments: [], sourceRun: {
            status: otherFailed ? 'incomplete' : 'completed', settings: options,
            sources: [
                { source: 'system', status: 'completed', segments: [] },
                { source: 'microphone', status: otherFailed ? 'failed' : 'completed', segments: [] },
            ],
        },
    };
    const fake = createFakeRendererAdapter({ transcribeSession: () => Promise.resolve({ ...session, transcript }) });
    const store = new AppStore(fake.adapter);

    store.workspace.replaceWorkspace(session);
    expect((await store.startTranscription(options)).ok).toBe(true);
    const html = renderToStaticMarkup(createElement(MantineProvider, null,
        createElement(AppContext.Provider, { value: store }, createElement(TranscribedText))));

    expect(store.transcription.hasCompletedSources).toBe(true);
    expect(store.transcription.allSourcesFailed).toBe(false);
    expect(store.transcription.plainText).toBe('');
    if (otherFailed) {
        expect(html).toContain('Completed sources are saved.');
        expect(store.activityLog.content).toContain('Whisper transcription is incomplete');
        expect(store.activityLog.content).not.toContain('Whisper transcription finished');
    } else {
        expect(html).not.toContain('Incomplete transcription');
        expect(html).not.toContain('Transcription failed');
        expect(store.activityLog.content).toContain('Whisper transcription finished');
        expect(store.transcription.runOutcome).toBe('success');
    }
});

describe('transcript duplicate filter presentation', () => {
    const sourceRun: NonNullable<SessionTranscriptV1['sourceRun']> = {
        status: 'completed',
        settings: options,
        sources: [
            {
                source: 'system',
                status: 'completed',
                segments: [{
                    source: 'system', startSec: 1, endSec: 3,
                    text: 'This shared phrase contains enough words for duplicate filtering',
                }],
            },
            {
                source: 'microphone',
                status: 'completed',
                segments: [{
                    source: 'microphone', startSec: 1.2, endSec: 3.2,
                    text: 'This shared phrase contains enough words for duplicate filtering local reply',
                }],
            },
        ],
    };

    it('persists the selected mode and keeps display, copy, and export representations consistent', async () => {
        const unfiltered = deriveSourceTranscript(sourceRun, false);
        const filtered = deriveSourceTranscript(sourceRun, true);
        const setTranscriptDuplicateFilter = vi.fn((_sessionId: string, enabled: boolean) => Promise.resolve({
            ...session,
            transcript: enabled ? filtered : unfiltered,
        }));
        const preferenceWrites: Array<{ key: UiPreferenceKey; value: UiPreferenceValueMap[UiPreferenceKey] }> = [];
        const setUiPreference = <K extends UiPreferenceKey>(key: K, value: UiPreferenceValueMap[K]) => {
            preferenceWrites.push({ key, value });

            return Promise.resolve(value);
        };
        const fake = createFakeRendererAdapter({ setTranscriptDuplicateFilter, setUiPreference });
        const store = new AppStore(fake.adapter);

        store.workspace.replaceWorkspace({ ...session, transcript: unfiltered });
        store.transcription.replaceSavedTranscript(unfiltered);

        const result = await store.setTranscriptDuplicateFilterEnabled(true);

        expect(result.ok).toBe(true);
        expect(setTranscriptDuplicateFilter).toHaveBeenCalledWith(session.id, true);
        expect(preferenceWrites).toContainEqual({ key: 'transcriptDuplicateFilterEnabled', value: true });
        expect(store.transcription.duplicateFilterEnabled).toBe(true);
        expect(store.transcription.plainText).toBe(
            'System audio: This shared phrase contains enough words for duplicate filtering\nMicrophone: local reply',
        );
        expect(store.transcription.timecodedText).toContain('Microphone: local reply');
        expect(store.transcription.renderedHtml).toContain('Microphone: local reply');
        expect(store.transcription.savedTranscript?.sourceRun?.sources[1].segments[0].text)
            .toContain('duplicate filtering local reply');

        expect((await store.setTranscriptDuplicateFilterEnabled(false)).ok).toBe(true);
        expect(store.transcription.plainText).toContain(
            'Microphone: This shared phrase contains enough words for duplicate filtering local reply',
        );
        expect((await store.setTranscriptDuplicateFilterEnabled(true)).ok).toBe(true);
        expect(store.transcription.plainText).toContain('Microphone: local reply');
    });

    it('uses the remembered preference for subsequent source-aware runs', async () => {
        const transcribeSession = vi.fn(() => Promise.resolve({
            ...session,
            transcript: deriveSourceTranscript(sourceRun, false),
        }));
        const getUiPreference = <K extends UiPreferenceKey>(key: K): Promise<UiPreferenceValueMap[K]> => {
            const value = key === 'transcriptDuplicateFilterEnabled' ? false : UI_PREFERENCE_DEFAULTS[key];

            return Promise.resolve(value as UiPreferenceValueMap[K]);
        };
        const fake = createFakeRendererAdapter({
            getUiPreference,
            transcribeSession,
        });
        const store = new AppStore(fake.adapter);

        store.workspace.replaceWorkspace(session);
        store.initialize();
        try {
            await settle();
            expect((await store.startTranscription({ ...options, microphoneGateEnabled: false })).ok).toBe(true);
            expect(transcribeSession).toHaveBeenCalledWith(session.id, expect.objectContaining({
                hideDuplicateSpeech: false,
                microphoneGateEnabled: false,
            }));
        } finally {
            store.dispose();
        }
    });

    it('reopens the persisted representation and leaves flattened legacy transcripts unchanged', async () => {
        const filtered = deriveSourceTranscript(sourceRun, true);
        const fake = createFakeRendererAdapter({
            getSession: (sessionId) => Promise.resolve({
                ...session,
                id: sessionId,
                transcript: filtered,
            }),
        });
        const store = new AppStore(fake.adapter);

        expect((await store.openSession(session.id)).ok).toBe(true);
        expect(store.transcription.duplicateFilterEnabled).toBe(true);
        expect(store.transcription.plainText).toContain('Microphone: local reply');

        const legacy: SessionTranscriptV1 = {
            version: 1,
            segments: [{ startSec: 0, endSec: null, text: 'Historical transcript' }],
        };
        store.transcription.replaceSavedTranscript(legacy);
        expect(store.transcription.duplicateFilterAvailable).toBe(false);
        expect(store.transcription.plainText).toBe('Historical transcript');
    });
});
