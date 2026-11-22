import type { BrowserWindow, IpcMain } from 'electron';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MantineProvider } from '@mantine/core';
import { expect, it, vi } from 'vitest';
import { AppContext } from '../AppContext';
import { AppStore } from './appStore';
import { createFakeRendererAdapter } from './testing/fakeRendererAdapter';
import { SpeakerAnalysisStatus } from '../features/transcribed-text/src/ui/TranscribedText/SpeakerControls';
import { registerSpeakerController } from '../../../electron/src/controllers/speakerController';
import { registerTranscriptionController } from '../../../electron/src/controllers/transcriptionController';
import { SpeakerAnalysisError } from '../../../electron/src/services/speakerProcess';
import type { SpeakerAnalysisResult, SpeakerDiarizationService } from '../../../electron/src/services/SpeakerDiarizationService';
import type { SessionsService } from '../../../electron/src/services/SessionsService';
import type { SessionDetails, SessionTranscriptV1 } from '../../../electron/src/types/sessions';
import type { TranscribeOpts } from '../../../electron/src/types/transcription';

const speakerMock = vi.hoisted(() => ({ runtime: null as Pick<SpeakerDiarizationService, 'getAssetStatus' | 'prepareAssets' | 'analyze'> | null }));
const whisperMock = vi.hoisted(() => ({ failure: null as Error | null, calls: [] as Array<{ path: string; options: TranscribeOpts }> }));
vi.mock('../../../electron/src/services/SpeakerDiarizationService', () => ({ SpeakerDiarizationService: class {
    getAssetStatus: SpeakerDiarizationService['getAssetStatus'] = (...args) => speakerMock.runtime!.getAssetStatus(...args);
    prepareAssets: SpeakerDiarizationService['prepareAssets'] = (...args) => speakerMock.runtime!.prepareAssets(...args);
    analyze: SpeakerDiarizationService['analyze'] = (...args) => speakerMock.runtime!.analyze(...args);
} }));
vi.mock('../../../electron/src/services/whisperServer/Whisper', () => ({ Whisper: class {
    startServer = () => Promise.resolve();
    stop = () => false;
    transcribeResult = (path: string, options: TranscribeOpts) => {
        whisperMock.calls.push({ path, options });
        return path === 'microphone.wav' && whisperMock.failure ? Promise.reject(whisperMock.failure) :
            Promise.resolve({ text: path === 'system.wav' ? 'Saved system text' : 'Recovered microphone text' });
    };
} }));
vi.mock('../../../electron/src/utils/whisper', () => ({ resolveWhisperPaths: () => ({}) }));

const sessionFixture = (): SessionDetails => ({ id: 'synthetic', title: 'Synthetic recording', createdAt: 0, updatedAt: 0,
    sourceKind: 'imported', hasTranscript: true, audioMode: 'original', audioOriginalPath: 'synthetic.wav', audioWavPath: 'synthetic.wav',
    transcript: { version: 1, segments: [{ startSec: 0, endSec: 1, text: 'Saved speech' }] } });

const harness = () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = { handle: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler) } as unknown as IpcMain;
    const fake = createFakeRendererAdapter();
    const store = new AppStore(fake.adapter);
    const window = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (channel: string, text: string) => {
        if (channel === 'transcribe:log') fake.emitTranscribeLog(text);
    } } } as unknown as BrowserWindow;
    return { handlers, ipc, fake, store, window };
};

it('keeps first-use analysis recovery visible and retries the chosen device through the speaker workflow', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { handlers, ipc, fake, store, window } = harness();
    const session = sessionFixture();
    let ready = false;
    const result: SpeakerAnalysisResult = { engine: 'nemotron-3', backend: 'cpu', device: 'cpu', preset: 'v3-offline',
        modelRevision: 'synthetic', runtimeRevision: 'synthetic', modelSha256: 'synthetic', runtimeSha256: 'synthetic',
        intervals: [{ startSec: 0, endSec: 1, speakerId: 'speaker' }] };
    const runtime = {
        getAssetStatus: () => Promise.resolve({ ready, gpuBackend: 'vulkan' as const, gpuAvailable: false }),
        prepareAssets: vi.fn(() => { ready = true; return Promise.resolve(); }),
        analyze: vi.fn<SpeakerDiarizationService['analyze']>().mockRejectedValueOnce(new SpeakerAnalysisError('SPEAKER_GPU_UNAVAILABLE')).mockResolvedValue(result),
    };
    speakerMock.runtime = runtime;
    const sessions = { getActiveSessionId: () => session.id, getActiveSessionGeneration: () => 0,
        getSession: () => Promise.resolve(structuredClone(session)), recognitionFingerprint: () => 'synthetic-fingerprint',
        prepareSourceAudio: () => Promise.resolve('synthetic.wav'),
        replaceTranscriptIfCurrent: (_id: string, _fingerprint: string, transcript: SessionTranscriptV1) => {
            session.transcript = structuredClone(transcript);
            return Promise.resolve(true);
        } } as unknown as SessionsService;
    registerSpeakerController(ipc, () => window, sessions, () => false);
    fake.adapter.getSession = (id) => sessions.getSession(id);
    fake.adapter.getSpeakerAssets = () => handlers.get('sessions:get-speaker-assets')!() as ReturnType<typeof fake.adapter.getSpeakerAssets>;
    fake.adapter.analyzeSpeakers = (id, options) => handlers.get('sessions:analyze-speakers')!(undefined, id, options) as Promise<SessionDetails>;
    store.initialize();
    try {
        await store.openSession(session.id);
        await store.speakers.refreshAssets();
        await store.speakers.setCompute('gpu');
        expect(store.speakers.componentReady).toBe(false);
        expect((await store.analyzeSpeakers()).ok).toBe(false);
        expect(ready).toBe(true);
        const render = () => renderToStaticMarkup(createElement(MantineProvider, null,
            createElement(AppContext.Provider, { value: store }, createElement(SpeakerAnalysisStatus))));
        expect(render()).toContain('Retry speaker analysis');
        expect(render()).toContain('Run on');
        expect(store.speakers.compute).toBe('gpu');
        expect(store.speakers.errorMessage).toContain('GPU');
        expect(store.transcription.savedTranscript?.segments[0].text).toBe('Saved speech');
        await store.speakers.setCompute('cpu');
        expect((await store.analyzeSpeakers()).ok).toBe(true);
        expect(runtime.analyze.mock.calls.map((call) => call[1].compute)).toEqual(['gpu', 'cpu']);
        expect(session.transcript?.speakers?.provenance).toMatchObject({ engine: 'nemotron-3', device: 'cpu' });
        expect(store.transcription.savedTranscript?.speakers?.speakers).toHaveLength(1);
        expect(store.speakers.compute).toBe('cpu');
        expect(store.speakers.status).toBe('success');
        expect(store.operations.isBusy).toBe(false);
    } finally { store.dispose(); }
});

it.each(['prepare', 'whisper'])('logs one original per-source %s cause and retries only the remaining source', async (boundary) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new Error('Synthetic microphone conversion failed', { cause: Object.assign(new Error('Synthetic disk is full'), { code: 'ENOSPC' }) });
    const { handlers, ipc, fake, store, window } = harness();
    const session = sessionFixture();
    session.sourceKind = 'recorded'; session.transcript = undefined; session.hasTranscript = false;
    session.tracks = [{ source: 'system', filePath: 'system.wav', startOffsetMs: 0 }, { source: 'microphone', filePath: 'microphone.wav', startOffsetMs: 0 }];
    let preparationFails = boundary === 'prepare';
    const repository = { getSession: (): Promise<SessionDetails> => Promise.resolve(structuredClone(session)),
        saveTranscript: (_id: string, transcript: SessionTranscriptV1) => { session.transcript = structuredClone(transcript); return Promise.resolve(); },
        prepareSourceAudio: (path: string) => path === 'microphone.wav' && preparationFails ? Promise.reject(error) : Promise.resolve(path) };
    whisperMock.calls = [];
    whisperMock.failure = boundary === 'whisper' ? error : null;
    registerTranscriptionController(ipc, () => window, repository as unknown as SessionsService);
    fake.adapter.getSession = repository.getSession;
    fake.adapter.transcribeSession = (id, options) => handlers.get('transcribe:session')!(undefined, id, options) as Promise<SessionDetails>;
    const analyze = vi.spyOn(fake.adapter, 'analyzeSpeakers');
    store.initialize();
    try {
        await store.openSession(session.id);
        await store.speakers.setEnabled(false);
        expect((await store.startTranscription({ language: 'en', model: 'base', splitOnWord: true, useVad: false })).ok).toBe(true);
        expect(store.transcription.isIncomplete).toBe(true);
        expect(store.transcription.savedTranscript?.segments[0].text).toBe('Saved system text');
        const saved = await repository.getSession();
        expect(saved.transcript?.sourceRun?.sources[1]).toMatchObject({ status: 'failed', error: 'Could not transcribe this source.' });
        const log = store.activityLog.content;
        expect(log).toContain('Synthetic microphone conversion failed');
        expect(log).toContain('ENOSPC');
        expect(log).toContain('Synthetic disk is full');
        expect(log.match(/Synthetic microphone conversion failed/g)).toHaveLength(1);
        expect(log).toContain('microphone');
        preparationFails = false;
        whisperMock.failure = null;
        expect((await store.retryIncompleteTranscription()).ok).toBe(true);
        expect(store.transcription.isIncomplete).toBe(false);
        expect(store.transcription.savedTranscript?.segments.map((segment) => segment.text)).toEqual(['Saved system text', 'Recovered microphone text']);
        expect(whisperMock.calls.filter((call) => call.path === 'system.wav')).toHaveLength(1);
        expect(whisperMock.calls.at(-1)).toMatchObject({ path: 'microphone.wav', options: { language: 'en', model: 'base' } });
        expect(analyze).not.toHaveBeenCalled();
        expect(store.operations.isBusy).toBe(false);
    } finally { store.dispose(); }
});
