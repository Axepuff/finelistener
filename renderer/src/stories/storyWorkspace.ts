import type { RecordingLevel, RecordingProgress, RecordingState } from 'electron/src/services/RecordingService';
import type { SessionDetails, SessionListItem, SessionTranscriptV1 } from 'electron/src/types/sessions';
import { UI_PREFERENCE_DEFAULTS, type UiPreferenceKey, type UiPreferenceValueMap } from '../../../electron/src/types/uiPreferences';
import { AppStore } from '../stores/appStore';
import { createFakeRendererAdapter } from '../stores/testing/fakeRendererAdapter';
import { STORY_AUDIO_PATH } from './storyAudio';

export type WorkspaceScenario = 'empty' | 'ready' | 'transcript' | 'long-transcript' | 'transcribing' | 'error' | 'recording-ready' | 'recording' | 'recording-error';

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
const transcriptSource = transcript.segments.map((segment) => (
    `[00:00:${segment.startSec.toFixed(3).padStart(6, '0')} --> 00:00:${segment.endSec!.toFixed(3).padStart(6, '0')}] ${segment.text}`
)).join('\n');

export const createStoryWorkspace = async (scenario: WorkspaceScenario): Promise<StoryWorkspace> => {
    const hasTranscript = scenario === 'transcript' || scenario === 'long-transcript';
    let session: SessionDetails = {
        id: 'storybook-session',
        title: 'Design discussion.wav',
        createdAt: 1791511200000,
        updatedAt: 1791511800000,
        sourceKind: 'imported',
        hasTranscript,
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
        } : structuredClone(transcript) : undefined,
    };
    const isRecorder = scenario.startsWith('recording');
    let sessions: SessionListItem[] = scenario === 'empty' || isRecorder ? [] : [session];
    let recordingState: RecordingState = scenario === 'recording' ? 'recording' : 'idle';
    let stateListener: ((state: RecordingState) => void) | null = null;
    let levelListener: ((level: RecordingLevel) => void) | null = null;
    let progressListener: ((progress: RecordingProgress) => void) | null = null;
    let finishTranscription: ((value: string) => void) | null = null;
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
        listSessions: () => Promise.resolve(sessions),
        getSession: () => Promise.resolve(session),
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
            if (scenario === 'recording-error') return Promise.reject(new Error('Demo recording device unavailable'));
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

    return {
        store,
        dispose: () => {
            store.dispose();
            finishTranscription?.('');
            finishTranscription = null;
        },
    };
};
