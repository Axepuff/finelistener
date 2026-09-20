import { MantineProvider } from '@mantine/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppContext } from '../AppContext';
import { TranscribedText } from '../features/transcribed-text/src/ui/TranscribedText/TranscribedText';
import type { RecordingResult, RecordingState } from 'electron/src/services/RecordingService';
import type { SessionDetails, SessionTranscriptV1 } from 'electron/src/types/sessions';
import type { SessionTranscribeOpts } from 'electron/src/types/transcription';
import { describe, expect, it, vi } from 'vitest';
import { AppStore } from './appStore';
import { createFakeRendererAdapter } from './testing/fakeRendererAdapter';
import { TranscriptionStore } from './transcriptionStore';

const session: SessionDetails = {
    id: 'recorded', title: 'Recording', createdAt: 1, updatedAt: 1, sourceKind: 'recorded',
    hasTranscript: false, audioOriginalPath: 'mix.wav', audioWavPath: 'mix.wav',
    tracks: [
        { source: 'system', filePath: 'system.wav', startOffsetMs: 0 },
        { source: 'microphone', filePath: 'microphone.wav', startOffsetMs: 0 },
    ],
};
const options = { language: 'en', model: 'base' as const, splitOnWord: true, useVad: true };
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
const captured: RecordingResult = {
    filePath: 'system.wav', format: { sampleRateHz: 16000, channels: 1, codec: 'pcm_s16le', bitDepth: 16 },
    tracks: session.tracks,
};

const settle = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };

describe('recording sources', () => {
    it('defaults both sources on, persists Off, rejects both Off, and imports all source files', async () => {
        const startSystemRecording = vi.fn(() => Promise.resolve({
            sessionId: 'capture', filePath: 'system.wav', startedAt: 1, format: captured.format,
        }));
        const importRecording = vi.fn(() => Promise.resolve(session));
        const fake = createFakeRendererAdapter({ runtimePlatform: 'win32', isRecordingAvailable: () => Promise.resolve(true),
            startSystemRecording, stopSystemRecording: () => Promise.resolve(captured), importRecording });
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
            expect(importRecording).toHaveBeenCalledWith(captured);
            expect(store.workspace.activeSession?.tracks).toEqual(session.tracks);
        } finally { store.dispose(); }
    });

    it('imports automatic finish once and retains the workspace lock through import', async () => {
        let emitFinished: (result: RecordingResult) => void = () => undefined;
        let emitState: (state: RecordingState) => void = () => undefined;
        let finishImport: (value: SessionDetails) => void = () => undefined;
        const importRecording = vi.fn(() => new Promise<SessionDetails>((resolve) => { finishImport = resolve; }));
        const stopSystemRecording = vi.fn(() => Promise.resolve(captured));
        const fake = createFakeRendererAdapter({
            getRecordingState: () => Promise.resolve('recording'), importRecording, stopSystemRecording,
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
            expect(store.operations.kind).toBe('processing-recording');
            expect(importRecording).toHaveBeenCalledOnce();
            expect(stopSystemRecording).not.toHaveBeenCalled();
            finishImport(session);
            await settle();
            expect(store.workspace.activeSessionId).toBe(session.id);
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
            expect(transcribeSession).toHaveBeenCalledWith(session.id, expect.objectContaining({ retryFailed: true, segment: { start: 2, end: 9 }, ...options }));
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
