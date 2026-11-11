import { MantineProvider } from '@mantine/core';
import type { SessionDetails, SessionTranscriptV1 } from 'electron/src/types/sessions';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppContext } from '../AppContext';
import { TranscribeControl } from '../features/transcribe-control';
import { AppStore } from './appStore';
import { createFakeRendererAdapter } from './testing/fakeRendererAdapter';
import { formatTranscriptPrefix, transcriptToText } from './transcriptFormat';

const transcript: SessionTranscriptV1 = {
    version: 1,
    recognitionRevision: 'revision-1',
    segments: [{ id: 'raw-1', startSec: 0, endSec: 1, text: 'Hello', source: 'microphone',
        rawSpan: { segmentId: 'raw-1', startChar: 0, endChar: 5 } }],
};

const labeledTranscript: SessionTranscriptV1 = {
    ...transcript,
    segments: [{ ...transcript.segments[0], speakerId: 'mic' }],
    speakers: {
        version: 1,
        recognitionRevision: 'revision-1',
        generation: 'generation-1',
        settings: {},
        intervals: [],
        speakers: [{ id: 'mic', name: 'Microphone speaker' }],
        corrections: [],
        status: 'completed',
    },
};

const session = (savedTranscript: SessionTranscriptV1, sourceKind: SessionDetails['sourceKind'] = 'imported'): SessionDetails => ({
    id: 'session-1', title: 'Session', createdAt: 1, updatedAt: 1,
    sourceKind, hasTranscript: true, audioMode: 'original', audioOriginalPath: '/audio.wav', audioWavPath: '/audio.wav',
    tracks: sourceKind === 'recorded' ? [{ source: 'microphone', filePath: '/mic.wav', startOffsetMs: 0 }] : undefined,
    transcript: savedTranscript,
});

describe('speaker analysis in the renderer', () => {
    it('offers optional CUDA preparation before transcription when speaker labels are enabled', async () => {
        const store = new AppStore(createFakeRendererAdapter().adapter);
        void store.speakers.setEnabled(false);
        store.workspace.replaceWorkspace(session(transcript));
        await store.speakers.setEnabled(true);
        store.speakers.setAssets({ cpuReady: true, cudaReady: false, cudaAvailable: true });

        const render = () => renderToStaticMarkup(createElement(MantineProvider, null,
            createElement(AppContext.Provider, { value: store }, createElement(TranscribeControl))));

        expect(render()).toContain('Prepare speaker component');
        expect(render()).toContain('recognition is saved first');
        store.speakers.setAssets({ cpuReady: true, cudaReady: true, cudaAvailable: true });
        expect(render()).not.toContain('Prepare speaker component');
    });

    it('does not replace freshly prepared assets with an older status response', async () => {
        let resolveOldStatus: (value: { cpuReady: boolean; cudaReady: boolean; cudaAvailable: boolean }) => void = () => undefined;
        const fake = createFakeRendererAdapter({
            getSpeakerAssets: () => new Promise((resolve) => { resolveOldStatus = resolve; }),
            prepareSpeakerAssets: () => Promise.resolve({ cpuReady: true, cudaReady: true, cudaAvailable: true }),
        });
        const store = new AppStore(fake.adapter);
        void store.speakers.setEnabled(false);
        store.speakers.initialize();
        expect((await store.prepareSpeakerAssets(true)).ok).toBe(true);
        resolveOldStatus({ cpuReady: true, cudaReady: false, cudaAvailable: true });
        await Promise.resolve();

        expect(store.speakers.assets?.cudaReady).toBe(true);
        store.speakers.dispose();
    });

    it('analyzes a microphone-only session without preparing assets or running ASR', async () => {
        const analyzeSpeakers = vi.fn(() => Promise.resolve(session(labeledTranscript, 'recorded')));
        const prepareSpeakerAssets = vi.fn(() => Promise.reject(new Error('must not download')));
        const transcribe = vi.fn(() => Promise.reject(new Error('must not transcribe')));
        const fake = createFakeRendererAdapter({ analyzeSpeakers, prepareSpeakerAssets, transcribe });
        const store = new AppStore(fake.adapter);
        void store.speakers.setEnabled(false);
        store.workspace.replaceWorkspace(session(transcript, 'recorded'));
        store.transcription.replaceSavedTranscript(transcript);

        expect((await store.analyzeSpeakers()).ok).toBe(true);
        expect(analyzeSpeakers).toHaveBeenCalledWith('session-1', expect.objectContaining({ speakerCount: undefined, audioMode: 'original', recognitionRevision: 'revision-1' }));
        expect(prepareSpeakerAssets).not.toHaveBeenCalled();
        expect(transcribe).not.toHaveBeenCalled();
        expect(store.transcription.plainText).toBe('Hello');
    });

    it('retains existing labels when a confirmed rerun fails', async () => {
        const analyzeSpeakers = vi.fn(() => Promise.reject(new Error('native process failed')));
        const fake = createFakeRendererAdapter({ analyzeSpeakers });
        const store = new AppStore(fake.adapter);
        void store.speakers.setEnabled(false);
        store.workspace.replaceWorkspace(session(labeledTranscript));
        store.transcription.replaceSavedTranscript(labeledTranscript);
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        try {
            expect((await store.analyzeSpeakers()).ok).toBe(false);
            expect(analyzeSpeakers).not.toHaveBeenCalled();
            expect((await store.analyzeSpeakers(true)).ok).toBe(false);
            expect(store.transcription.savedTranscript?.speakers?.generation).toBe('generation-1');
            expect(store.speakers.status).toBe('error');
        } finally {
            error.mockRestore();
        }
    });

    it('keeps saved labels available when a speaker edit fails', async () => {
        const renameSpeaker = vi.fn(() => Promise.reject(new Error('write failed')));
        const fake = createFakeRendererAdapter({ renameSpeaker });
        const store = new AppStore(fake.adapter);
        void store.speakers.setEnabled(false);
        store.workspace.replaceWorkspace(session(labeledTranscript));
        store.transcription.replaceSavedTranscript(labeledTranscript);
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        try {
            expect((await store.renameSpeaker('mic', 'Alice')).ok).toBe(false);
            expect(renameSpeaker).toHaveBeenCalledWith('session-1', 'mic', 'Alice');
            expect(store.transcription.savedTranscript?.speakers?.speakers[0]?.name).toBe('Microphone speaker');
        } finally {
            error.mockRestore();
        }
    });

    it('adds labels after saved ASR without a second recognition run', async () => {
        const transcribe = vi.fn(() => Promise.resolve('[00:00:00.000 --> 00:00:01.000] Hello\n'));
        const analyzeSpeakers = vi.fn(() => Promise.resolve(session(labeledTranscript)));
        const fake = createFakeRendererAdapter({
            transcribe,
            getSession: () => Promise.resolve(session(transcript)),
            analyzeSpeakers,
        });
        const store = new AppStore(fake.adapter);
        void store.speakers.setEnabled(false);
        store.workspace.replaceWorkspace(session({ version: 1, segments: [] }));
        await store.speakers.setEnabled(true);

        expect((await store.startTranscription({ language: 'en', model: 'base', splitOnWord: true, useVad: true })).ok).toBe(true);
        expect(transcribe).toHaveBeenCalledOnce();
        expect(analyzeSpeakers).toHaveBeenCalledOnce();
        expect(store.transcription.savedTranscript?.speakers?.generation).toBe('generation-1');
    });

    it('reports a failed replacement without labeling the previous recognition', async () => {
        const transcribeSession = vi.fn(() => Promise.reject(new Error('All new sources failed')));
        const analyzeSpeakers = vi.fn();
        const fake = createFakeRendererAdapter({ transcribeSession, analyzeSpeakers });
        const store = new AppStore(fake.adapter);
        void store.speakers.setEnabled(false);
        store.workspace.replaceWorkspace(session(transcript, 'recorded'));
        store.transcription.replaceSavedTranscript(transcript);
        await store.speakers.setEnabled(true);
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        try {
            const result = await store.startTranscription({
                language: 'en', model: 'base', splitOnWord: true, useVad: true,
            });

            expect(result).toEqual({ ok: false, message: 'Transcription failed.' });
            expect(store.transcription.savedTranscript).toEqual(transcript);
            expect(store.transcription.runOutcome).toBe('error');
            expect(store.transcription.progress).not.toBe(100);
            expect(analyzeSpeakers).not.toHaveBeenCalled();
        } finally {
            error.mockRestore();
        }
    });

    it('keeps the speaker option selected at transcription start', async () => {
        let finishRecognition: (value: string) => void = () => undefined;
        const transcribe = vi.fn(() => new Promise<string>((resolve) => { finishRecognition = resolve; }));
        const analyzeSpeakers = vi.fn(() => Promise.resolve(session(labeledTranscript)));
        const fake = createFakeRendererAdapter({
            transcribe,
            getSession: () => Promise.resolve(session(transcript)),
            analyzeSpeakers,
        });
        const store = new AppStore(fake.adapter);
        void store.speakers.setEnabled(false);
        store.workspace.replaceWorkspace(session({ version: 1, segments: [] }));
        await store.speakers.setEnabled(true);
        store.speakers.setSpeakerCount(2);

        const pending = store.startTranscription({ language: 'en', model: 'base', splitOnWord: true, useVad: true });
        await store.speakers.setEnabled(false);
        store.speakers.setSpeakerCount(3);
        finishRecognition('Hello');

        expect((await pending).ok).toBe(true);
        expect(analyzeSpeakers).toHaveBeenCalledWith('session-1', expect.objectContaining({ speakerCount: 2, audioMode: 'original' }));
    });

    it('requires a new replacement confirmation after a model download changes sessions', async () => {
        const transcribe = vi.fn(() => Promise.resolve('New text'));
        const fake = createFakeRendererAdapter({
            transcribe,
            getSession: () => Promise.resolve({ ...session(labeledTranscript), id: 'session-2' }),
            downloadWhisperModel: () => Promise.resolve(),
        });
        const store = new AppStore(fake.adapter);
        void store.speakers.setEnabled(false);
        store.workspace.replaceWorkspace(session(labeledTranscript));
        store.transcription.replaceSavedTranscript(labeledTranscript);

        expect((await store.requestTranscriptionStart(true)).ok).toBe(true);
        expect(store.transcriptionControl.pendingDownloadModel).toBe('large');
        expect((await store.openSession('session-2')).ok).toBe(true);
        expect((await store.confirmPendingTranscriptionDownload()).ok).toBe(false);
        expect(transcribe).not.toHaveBeenCalled();
    });

    it('honors a replacement confirmation through a model download for the same session', async () => {
        const transcribe = vi.fn(() => Promise.resolve('New text'));
        const fake = createFakeRendererAdapter({
            transcribe,
            getSession: () => Promise.resolve(session(labeledTranscript)),
            downloadWhisperModel: () => Promise.resolve(),
        });
        const store = new AppStore(fake.adapter);
        void store.speakers.setEnabled(false);
        store.workspace.replaceWorkspace(session(labeledTranscript));
        store.transcription.replaceSavedTranscript(labeledTranscript);

        expect((await store.requestTranscriptionStart(true)).ok).toBe(true);
        expect((await store.confirmPendingTranscriptionDownload()).ok).toBe(true);
        expect(transcribe).toHaveBeenCalledOnce();
    });

    it('requires confirmation before retrying a source when the partial transcript has speaker edits', async () => {
        const partial: SessionTranscriptV1 = {
            ...labeledTranscript,
            sourceRun: {
                status: 'incomplete',
                settings: { language: 'en', model: 'base' },
                sources: [
                    { source: 'microphone', status: 'completed', segments: transcript.segments },
                    { source: 'system', status: 'failed', segments: [] },
                ],
            },
        };
        const completed: SessionTranscriptV1 = {
            ...partial,
            speakers: undefined,
            sourceRun: { ...partial.sourceRun!, status: 'completed' },
        };
        const transcribeSession = vi.fn(() => Promise.resolve(session(completed, 'recorded')));
        const fake = createFakeRendererAdapter({ transcribeSession });
        const store = new AppStore(fake.adapter);
        void store.speakers.setEnabled(false);
        store.workspace.replaceWorkspace(session(partial, 'recorded'));
        store.transcription.replaceSavedTranscript(partial);

        expect((await store.retryIncompleteTranscription()).ok).toBe(false);
        expect(transcribeSession).not.toHaveBeenCalled();
        expect((await store.retryIncompleteTranscription(true)).ok).toBe(true);
        expect(transcribeSession).toHaveBeenCalledOnce();
    });

    it('does not publish late analysis output after cancellation', async () => {
        let resolveAnalysis: (value: SessionDetails) => void = () => undefined;
        let resolveStop: (value: boolean) => void = () => undefined;
        const analyzeSpeakers = vi.fn(() => new Promise<SessionDetails>((resolve) => { resolveAnalysis = resolve; }));
        const fake = createFakeRendererAdapter({
            analyzeSpeakers,
            stopSpeakerAnalysis: () => new Promise<boolean>((resolve) => { resolveStop = resolve; }),
        });
        const store = new AppStore(fake.adapter);
        void store.speakers.setEnabled(false);
        store.workspace.replaceWorkspace(session(transcript));
        store.transcription.replaceSavedTranscript(transcript);

        const pending = store.analyzeSpeakers();
        await vi.waitFor(() => expect(analyzeSpeakers).toHaveBeenCalledOnce());
        expect(store.operations.kind).toBe('analyzing-speakers');
        const stopping = store.stopSpeakerAnalysis();
        resolveAnalysis(session(labeledTranscript));
        await Promise.resolve();
        expect(store.transcription.savedTranscript?.speakers).toBeUndefined();
        expect(store.operations.kind).toBe('analyzing-speakers');
        resolveStop(true);
        expect((await stopping).ok).toBe(true);
        await pending;

        expect(store.transcription.savedTranscript?.speakers).toBeUndefined();
        expect(store.speakers.status).toBe('cancelled');
    });

    it('cancels before main analysis starts while activating the session', async () => {
        let activate: (value: boolean) => void = () => undefined;
        const analyzeSpeakers = vi.fn(() => Promise.resolve(session(labeledTranscript)));
        const stopSpeakerAnalysis = vi.fn(() => Promise.resolve(false));
        const fake = createFakeRendererAdapter({
            setActiveSession: () => new Promise<boolean>((resolve) => { activate = resolve; }),
            analyzeSpeakers,
            stopSpeakerAnalysis,
        });
        const store = new AppStore(fake.adapter);
        void store.speakers.setEnabled(false);
        store.workspace.replaceWorkspace(session(transcript));
        store.transcription.replaceSavedTranscript(transcript);

        const pending = store.analyzeSpeakers();
        expect((await store.stopSpeakerAnalysis()).ok).toBe(true);
        activate(true);
        await pending;

        expect(analyzeSpeakers).not.toHaveBeenCalled();
        expect(stopSpeakerAnalysis).not.toHaveBeenCalled();
        expect(store.speakers.status).toBe('cancelled');
    });

    it('uses the same speaker and source labels for Speakers export', () => {
        expect(formatTranscriptPrefix(labeledTranscript.segments[0], labeledTranscript)).toBe('Microphone · Microphone speaker: ');
        expect(transcriptToText(labeledTranscript, 'speakers')).toContain('Microphone · Microphone speaker: Hello');
        expect(formatTranscriptPrefix(transcript.segments[0], transcript)).toBe('Microphone: ');
    });
});
