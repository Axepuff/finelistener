import type { RecordingLevel, RecordingProgress, RecordingState } from 'electron/src/services/RecordingService';
import type { SessionDetails, SessionListItem, SessionSummary, SessionTranscriptV1, SummaryGenerationResult } from 'electron/src/types/sessions';
import type { SummaryModelStatus } from 'electron/src/types/summaryModel';
import { defaultRecordingSummaryOptions, recordingSummaryGenerationVersion } from '../../../electron/src/types/summaryOptions';
import { UI_PREFERENCE_DEFAULTS, type UiPreferenceKey, type UiPreferenceValueMap } from '../../../electron/src/types/uiPreferences';
import { AppStore } from '../stores/appStore';
import { createFakeRendererAdapter } from '../stores/testing/fakeRendererAdapter';
import { STORY_AUDIO_PATH } from './storyAudio';

export type WorkspaceScenario = 'empty' | 'ready' | 'transcript' | 'speakers' | 'long-transcript' | 'transcribing' | 'error' | 'recording-ready' | 'recording' | 'recording-error' | 'recording-start-error'
    | 'summary-ready' | 'summary-install' | 'summary-downloading' | 'summary-download-error' | 'summary-generating'
    | 'summary-cancel' | 'summary-error' | 'summary-saved' | 'summary-partial'
    | 'nemotron' | 'nemotron-reading' | 'nemotron-downloading' | 'nemotron-analyzing' | 'nemotron-error';

export interface StoryWorkspace {
    store: AppStore;
    dispose: () => void;
}

const transcript: SessionTranscriptV1 = {
    version: 1,
    segments: [
        { startSec: 0, endSec: 4, text: 'Let us review the recording workflow and make the next action clear. ' },
        { startSec: 4, endSec: 8, text: 'The transcript should stay easy to read while we listen and compare details. ' },
        { startSec: 8, endSec: 12, text: 'Search for recording, switch to timecodes, or click a passage to seek the audio.' },
    ],
};
const speakerTranscript: SessionTranscriptV1 = {
    ...transcript,
    recognitionRevision: 'demo-revision',
    segments: transcript.segments.map((segment, index) => ({
        ...segment,
        speakerId: index < 2 ? 'alice' : 'bob',
        rawSpan: { segmentId: `demo-${index}`, startChar: 0, endChar: segment.text.length },
    })),
    speakers: {
        version: 1, recognitionRevision: 'demo-revision', generation: 'demo-generation',
        settings: {}, intervals: [], corrections: [], status: 'completed',
        speakers: [{ id: 'alice', name: 'Alice' }, { id: 'bob', name: 'Bob' }],
    },
};
const transcriptSource = transcript.segments.map((segment) => (
    `[00:00:${segment.startSec.toFixed(3).padStart(6, '0')} --> 00:00:${segment.endSec!.toFixed(3).padStart(6, '0')}] ${segment.text}`
)).join('\n');

export const createStoryWorkspace = async (scenario: WorkspaceScenario): Promise<StoryWorkspace> => {
    const isNemotron = scenario.startsWith('nemotron');
    const hasTranscript = scenario === 'transcript' || scenario === 'long-transcript' || scenario === 'speakers' || isNemotron || scenario.startsWith('summary-');
    let session: SessionDetails = {
        id: 'storybook-session',
        title: 'Design discussion.wav',
        createdAt: 1791511200000,
        updatedAt: 1791511800000,
        sourceKind: 'imported',
        hasTranscript,
        transcription: { language: 'en' },
        audioMode: 'optimized',
        audioOriginalPath: STORY_AUDIO_PATH,
        audioWavPath: STORY_AUDIO_PATH,
        audioOptimizedWavPath: STORY_AUDIO_PATH,
        transcript: hasTranscript ? scenario === 'long-transcript' ? {
            version: 1,
            segments: Array.from({ length: 60 }, (_, index) => ({
                startSec: index / 5,
                endSec: (index + 1) / 5,
                text: `Passage ${index + 1}. ${transcript.segments[index % 3].text}`,
            })),
        } : structuredClone(scenario === 'speakers' || isNemotron ? speakerTranscript : transcript) : undefined,
    };
    if (isNemotron && session.transcript?.speakers) session.transcript.speakers.provenance = {
        version: 1, engine: 'nemotron-3', modelRevision: 'demo-model', runtimeRevision: 'demo-runtime',
        modelSha256: 'demo', runtimeSha256: 'demo', audioMode: 'optimized', backend: 'vulkan',
        device: 'vulkan:0', preset: 'v3-offline', assignmentPolicy: 'conservative-overlap-v1', acousticIntervals: [],
    };
    if (scenario === 'nemotron-reading' && session.transcript?.speakers?.provenance?.engine === 'nemotron-3') {
        session.transcript.segments = [
            { startSec: 0, endSec: 3, text: 'Could we move rehearsal', speakerId: 'alice' },
            { startSec: 3, endSec: 3.6, text: 'yes,', speakerId: 'bob' },
            { startSec: 3.6, endSec: 5.7, text: 'to Friday afternoon?', speakerId: 'alice' },
            { startSec: 5.7, endSec: 6.4, text: 'Friday', speakerId: null },
            { startSec: 6.4, endSec: 9.8, text: 'works for me.', speakerId: 'bob' },
            { startSec: 10, endSec: 12, text: 'Perfect.', speakerId: 'alice' },
        ].map((segment, index) => {
            const tokens = Array.from(segment.text.matchAll(/\w+/g));
            const step = (segment.endSec - segment.startSec) / tokens.length;
            return {
                ...segment,
                rawSpan: { segmentId: `dialogue-${index}`, startChar: 0, endChar: segment.text.length },
                words: tokens.map((token, i) => ({
                    text: token[0], startChar: token.index, endChar: token.index + token[0].length,
                    startSec: segment.startSec + i * step, endSec: segment.startSec + (i + 1) * step,
                })),
            };
        });
        session.transcript.speakers.provenance.acousticIntervals = [
            { speakerId: 'alice', startSec: 0, endSec: 3.4 },
            { speakerId: 'bob', startSec: 3, endSec: 3.6 },
            { speakerId: 'alice', startSec: 3.6, endSec: 6.4 },
            { speakerId: 'bob', startSec: 5.7, endSec: 9.8 },
            { speakerId: 'alice', startSec: 10, endSec: 12 },
        ];
    }
    const demoSummary: SessionSummary = {
        detailed: 'The team reviewed how listeners find a passage after a recording. Opening a saved session should restore its transcript and the audio it belongs to.\n\nListeners can search for a word to locate a passage. In the timecoded view, selecting a time takes playback to that point so the listener can hear what was said in context.',
        brief: 'The team reviewed how listeners reopen a recording, search its transcript and jump to the passage they want to hear.',
        model: 'Qwen3-4B-Instruct', inputHash: 'demo', generationVersion: 2,
    };
    if (scenario === 'summary-saved' && session.transcript) {
        session.transcript.segments.push(
            { startSec: 12, endSec: 38, text: 'In a long interview I often come back to the same word. Show the surrounding lines so I can tell which match I want. I can check by playing the answer from there.' },
            { startSec: 38, endSec: 67, text: 'I tried that with the delivery date. The first mention was a question. I had to keep listening until the other speaker confirmed Friday. Seeing who spoke would help.' },
            { startSec: 67, endSec: 95, text: 'Let us try two versions, one that shows the speaker beside each match and one that shows just the time. We can compare them next week before picking one.' },
        );
        session.transcript.summary = {
            ...demoSummary,
            generationVersion: 3,
            options: { prompt: 'Describe how the speakers compare ways to find a passage.', chunkCount: 12, overlapPercent: 25 },
            brief: 'The team compared ways to find a particular answer in a saved interview. Next week they will test whether showing the speaker alongside each search result makes that easier.',
            detailed: [
                demoSummary.detailed,
                'In a long interview, the same word can lead to several different answers. The team wanted each match to show enough of the surrounding conversation to decide which passage to play.',
                'One listener searched for a delivery date. The first mention was a question. It took a later reply to establish that delivery was due on Friday, and the listener wanted to see who had confirmed it.',
                'The team will try two versions the following week. One will show the speaker beside each match and the other will show only the time. They will compare the two before deciding which to keep.',
            ].join('\n\n'),
        };
    }
    const reviewedChunks = demoSummary.detailed.split('\n\n').map((text, i) => ({ startSec: 6 * i, endSec: 6 * (i + 1), text }));
    if (scenario === 'summary-partial' && session.transcript) session.transcript.summary = {
        ...demoSummary, brief: '', generationVersion: recordingSummaryGenerationVersion, options: defaultRecordingSummaryOptions, reviewedChunks,
    };
    let modelStatus: SummaryModelStatus = {
        model: 'Qwen3-4B-Instruct', totalBytes: 2_497_281_120, downloadedBytes: 0, state: 'ready',
    };
    if (scenario === 'summary-install' || scenario === 'summary-saved') modelStatus.state = 'missing';
    if (scenario === 'summary-downloading') modelStatus = { ...modelStatus, state: 'downloading', downloadedBytes: 874_048_392 };
    if (scenario === 'summary-download-error') modelStatus = { ...modelStatus, state: 'error', error: 'download' };
    let modelListener: ((status: SummaryModelStatus) => void) | undefined;
    const setModelStatus = (state: SummaryModelStatus['state'], downloadedBytes: number) => {
        modelStatus = { model: modelStatus.model, totalBytes: modelStatus.totalBytes, state, downloadedBytes };
        modelListener?.(modelStatus);
    };
    const isRecorder = scenario.startsWith('recording');
    let sessions: SessionListItem[] = scenario === 'empty' || isRecorder ? [] : [session];
    let recordingState: RecordingState = scenario === 'recording' ? 'recording' : 'idle';
    let stateListener: ((state: RecordingState) => void) | null = null;
    let levelListener: ((level: RecordingLevel) => void) | null = null;
    let progressListener: ((progress: RecordingProgress) => void) | null = null;
    let finishTranscription: ((value: string) => void) | null = null;
    let summaryAttempt = 0;
    let cancelSummary: (() => void) | undefined;
    const preferences: UiPreferenceValueMap = { ...UI_PREFERENCE_DEFAULTS, speakerLabelsEnabled: false, homeSidebarWidth: 300, recordingSystemDevice: 'demo-system', recordingMicrophoneDevice: 'demo-microphone' };
    const emitRecording = () => {
        stateListener?.(recordingState);
        if (recordingState === 'recording') {
            levelListener?.({ source: 'system', rms: 0.12, peak: 0.4, clipped: false });
            levelListener?.({ source: 'microphone', rms: 0.06, peak: 0.2, clipped: false });
            progressListener?.({ durationMs: 42000, bytesWritten: 1344000 });
        }
    };
    const fake = createFakeRendererAdapter({
        runtimePlatform: 'win32',
        ...(isNemotron ? { getSpeakerAssets: () => Promise.resolve({ gpuBackend: 'vulkan' as const,
            ready: scenario !== 'nemotron-downloading', gpuAvailable: scenario !== 'nemotron-error', downloadBytes: 123_671_929 }) } : {}),
        listSessions: () => Promise.resolve(sessions),
        getSession: () => Promise.resolve(session),
        getSummaryModelStatus: () => Promise.resolve(modelStatus),
        onSummaryModelChanged: (callback) => { modelListener = callback; return () => { modelListener = undefined; }; },
        downloadSummaryModel: async () => {
            setModelStatus('downloading', Math.floor(modelStatus.totalBytes / 2));
            await new Promise((resolve) => setTimeout(resolve, 250));
            setModelStatus('ready', modelStatus.totalBytes);
            return modelStatus;
        },
        generateSummary: (_sessionId, options = defaultRecordingSummaryOptions) => {
            summaryAttempt += 1;
            if (scenario === 'summary-error' && summaryAttempt === 1) return Promise.resolve({ ok: false as const, reason: 'failed' as const });
            if ((scenario === 'summary-cancel' || scenario === 'summary-generating') && summaryAttempt === 1) {
                return new Promise<SummaryGenerationResult>((resolve) => {
                    cancelSummary = () => resolve({ ok: false, reason: 'cancelled' });
                });
            }
            const summary = { ...demoSummary, generationVersion: recordingSummaryGenerationVersion, options, reviewedChunks };
            if (session.transcript) session = { ...session, transcript: { ...session.transcript, summary } };
            return Promise.resolve({ ok: true as const, summary });
        },
        stopSummary: () => {
            cancelSummary?.();
            cancelSummary = undefined;
            return Promise.resolve(true);
        },
        importAudio: () => {
            sessions = [session];
            return Promise.resolve(session);
        },
        deleteSession: (id) => {
            sessions = sessions.filter((item) => item.id !== id);
            return Promise.resolve(true);
        },
        optimizeAudio: (_id, mode) => {
            session = { ...session, audioMode: mode ?? 'optimized' };
            return Promise.resolve(session);
        },
        getWhisperModels: () => Promise.resolve(['large', 'base', 'small'].map((name) => ({
            name: name as 'large' | 'base' | 'small', sizeLabel: 'Demo', isDownloaded: true, isBundled: true,
        }))),
        getUiPreference: <K extends UiPreferenceKey>(key: K) => Promise.resolve(preferences[key]),
        setUiPreference: <K extends UiPreferenceKey>(key: K, value: UiPreferenceValueMap[K]) => {
            preferences[key] = value;
            return Promise.resolve(value);
        },
        isRecordingAvailable: () => Promise.resolve(true),
        getRecordingPermissionStatus: () => Promise.resolve('granted'),
        getRecordingState: () => Promise.resolve(recordingState),
        listRecordingDevices: () => Promise.resolve([
            { id: 'demo-system', name: 'Speakers (demo)', source: 'system', isDefault: true },
            { id: 'demo-microphone', name: 'Microphone (demo)', source: 'microphone', isDefault: true },
        ]),
        onRecordingState: (callback) => { stateListener = callback; return () => { stateListener = null; }; },
        onRecordingLevel: (callback) => { levelListener = callback; return () => { levelListener = null; }; },
        onRecordingProgress: (callback) => { progressListener = callback; return () => { progressListener = null; }; },
        startSystemRecording: () => {
            if (scenario === 'recording-error' || scenario === 'recording-start-error') return Promise.reject(new Error('Demo recording device unavailable'));
            recordingState = 'recording';
            emitRecording();
            return Promise.resolve({ recordingId: 'demo-recording', startedAt: Date.now() });
        },
        stopSystemRecording: () => {
            recordingState = 'idle';
            emitRecording();
            session = { ...session, sourceKind: 'recorded' };
            sessions = [session];
            return Promise.resolve({ recordingId: 'demo-recording', sessionId: session.id, sourceWarnings: [] });
        },
        transcribe: (_path, options) => {
            if (scenario === 'error') return Promise.reject(new Error('Demo transcription failure'));
            if (scenario !== 'transcribing') {
                session = { ...session, hasTranscript: true, transcript: structuredClone(transcript) };
                sessions = [session];
                return Promise.resolve(transcriptSource);
            }

            return new Promise<string>((resolve) => {
                finishTranscription = resolve;
                fake.emitTranscribeText({ runId: options.runId, chunk: transcriptSource.split('\n')[0] });
                fake.emitTranscribeProgress({ runId: options.runId, value: 42 });
            });
        },
        stopTranscription: () => {
            finishTranscription?.('');
            finishTranscription = null;
            return Promise.resolve(true);
        },
    });
    const store = new AppStore(fake.adapter);
    store.initialize();
    await store.whisperModels.refresh();
    if (scenario !== 'empty' && !isRecorder) {
        const result = await store.openSession(session.id);
        if (!result.ok) { store.dispose(); throw new Error(result.message); }
    }
    if (scenario === 'transcribing' || scenario === 'error') {
        const run = store.startTranscription({ language: 'en', model: 'base', splitOnWord: true, useVad: true });
        if (scenario === 'error') await run;
        else void run.catch((error: unknown) => { console.error('Story transcription setup failed', error); });
    }
    if (scenario === 'recording-error') await store.recording.startRecording();
    if (scenario === 'recording') emitRecording();
    if (isNemotron) {
        await store.speakers.setEnabled(true);
        if (scenario === 'nemotron-downloading' || scenario === 'nemotron-analyzing') {
            store.operations.begin(scenario === 'nemotron-downloading' ? 'preparing-speaker-assets' : 'analyzing-speakers');
            store.speakers.begin();
            store.speakers.updateProgress({ sessionId: session.id,
                phase: scenario === 'nemotron-downloading' ? 'downloading' : 'analyzing',
                ...(scenario === 'nemotron-downloading' ? { downloadedBytes: 61_835_965, totalBytes: 123_671_929 } : {}) });
        }
        if (scenario === 'nemotron-error') store.speakers.fail('GPU speaker analysis is unavailable. Select CPU or update your graphics driver.');
    }

    return {
        store,
        dispose: () => {
            store.dispose();
            finishTranscription?.('');
            finishTranscription = null;
        },
    };
};
