import type { SessionDetails } from 'electron/src/types/sessions';
import { autorun } from 'mobx';
import { expect, it } from 'vitest';
import { AppStore } from './appStore';
import { createFakeRendererAdapter } from './testing/fakeRendererAdapter';

const session: SessionDetails = {
    id: 'session-1', title: 'Audio', createdAt: 1, updatedAt: 1,
    sourceKind: 'imported', hasTranscript: true,
    audioMode: 'original',
    audioOriginalPath: '/audio/original.mp3', audioWavPath: '/audio/source.wav',
    transcript: { version: 1, segments: [{ startSec: 0, endSec: 1, text: 'Previous transcript' }] },
};

it('retains the current transcript when audio optimization returns old session metadata', async () => {
    const fake = createFakeRendererAdapter({
        getSession: () => Promise.resolve(session),
        transcribe: () => Promise.resolve('[00:00:00.000 --> 00:00:01.000] New transcript\n'),
        optimizeAudio: () => Promise.resolve({ ...session, audioOptimizedWavPath: '/audio/optimized.wav' }),
    });
    const store = new AppStore(fake.adapter);
        void store.speakers.setEnabled(false);

    await store.openSession(session.id);
    expect(store.transcription.plainText).toBe('Previous transcript');
    expect((await store.startTranscription({
        language: 'en', model: 'base', splitOnWord: true, useVad: true,
    })).ok).toBe(true);
    expect((await store.setAudioMode('optimized')).ok).toBe(true);
    expect(store.transcription.plainText).toBe('New transcript');
    expect(store.workspace.activeSession).not.toHaveProperty('transcript');
    expect(store.workspace.activeSession).not.toHaveProperty('hasTranscript');
    expect((await store.setAudioMode('original')).ok).toBe(true);
    expect(store.transcription.plainText).toBe('New transcript');

    expect(store.clearWorkspace().ok).toBe(true);
    expect(store.workspace.activeSession).toBeNull();
    expect(store.transcription.savedTranscript).toBeNull();
    expect(store.transcription.draftTranscript).toBeNull();
});

it('publishes session identity and saved transcript as one workspace transition', async () => {
    const withoutTranscript: SessionDetails = { ...session, id: 'session-2', hasTranscript: false, transcript: undefined };
    const fake = createFakeRendererAdapter({
        getSession: (id) => Promise.resolve(id === session.id ? session : withoutTranscript),
    });
    const store = new AppStore(fake.adapter);
        void store.speakers.setEnabled(false);
    const snapshots: Array<[string | null, string]> = [];
    const unsubscribe = autorun(() => {
        snapshots.push([store.workspace.activeSessionId, store.transcription.plainText]);
    });

    try {
        await store.openSession(session.id);
        await store.openSession(withoutTranscript.id);
        expect(snapshots).toEqual([
            [null, ''],
            ['session-1', 'Previous transcript'],
            ['session-2', ''],
        ]);
    } finally {
        unsubscribe();
    }
});

it.each(['imported', 'recorded', 'incomplete'] as const)('refreshes saved metadata after %s transcription without resetting playback', async (kind) => {
    let savedSession: SessionDetails = {
        ...session, transcription: { language: 'ru' },
        ...(kind !== 'imported' ? { tracks: [{ source: 'system', filePath: '/audio/system.wav', startOffsetMs: 0 }] } : {}),
    };
    const saveTranscription = () => {
        savedSession = {
            ...savedSession, updatedAt: 2, transcription: { language: 'en' },
            transcript: {
                version: 1, segments: [{ startSec: 2, endSec: 3, text: 'Final text' }],
                ...(kind === 'incomplete' ? { sourceRun: {
                    status: 'incomplete', settings: { language: 'en' },
                    sources: [
                        { source: 'system', status: 'completed', segments: [{ startSec: 2, endSec: 3, text: 'Final text' }] },
                        { source: 'microphone', status: 'failed', segments: [] },
                    ],
                } as const } : {}),
            },
        };
        return savedSession;
    };
    const fake = createFakeRendererAdapter({
        getSession: () => Promise.resolve(savedSession),
        transcribe: () => {
            saveTranscription();
            return Promise.resolve('[00:00:02.000 --> 00:00:03.000] Final text\n');
        },
        transcribeSession: () => Promise.resolve(saveTranscription()),
    });
    const store = new AppStore(fake.adapter);
    await store.speakers.setEnabled(false);
    store.initialize();
    try {
        expect((await store.openSession(session.id)).ok).toBe(true);
        store.workspace.setPlaybackPosition(7);
        store.workspace.setPlaying(true);
        store.workspace.setSegmentStart(2);
        store.workspace.setSegmentEnd(9);
        expect((await store.startTranscription({ language: 'en', model: 'base', splitOnWord: true, useVad: true })).ok).toBe(true);
        expect(store.transcription.plainText).toBe('Final text');
        expect(store.workspace.activeSession?.transcription?.language).toBe('en');
        expect(store.workspace.activeSession?.updatedAt).toBe(2);
        expect(store.workspace.playbackPosition).toBe(7);
        expect(store.workspace.isPlaying).toBe(true);
        expect(store.workspace.selectedSegment).toEqual({ start: 2, end: 9 });
        expect(store.workspace.audioSourcePath).toBe(session.audioWavPath);
        expect(store.workspace.audioMode).toBe('original');
    } finally {
        store.dispose();
    }
});

it('ignores a delayed metadata refresh after another session is opened', async () => {
    const other: SessionDetails = { ...session, id: 'session-2', updatedAt: 3, transcription: { language: 'de' } };
    let finishRefresh!: (value: SessionDetails) => void;
    let refreshStarted!: () => void;
    let transcribed = false;
    const refreshing = new Promise<void>((resolve) => { refreshStarted = resolve; });
    const refreshed = new Promise<SessionDetails>((resolve) => { finishRefresh = resolve; });
    const fake = createFakeRendererAdapter({
        getSession: (id) => {
            if (id === other.id) return Promise.resolve(other);
            if (!transcribed) return Promise.resolve(session);
            refreshStarted();
            return refreshed;
        },
        transcribe: () => {
            transcribed = true;
            return Promise.resolve('[00:00:00.000 --> 00:00:01.000] Final text\n');
        },
    });
    const store = new AppStore(fake.adapter);
    await store.speakers.setEnabled(false);
    store.initialize();
    try {
        await store.openSession(session.id);
        const run = store.startTranscription({ language: 'en', model: 'base', splitOnWord: true, useVad: true });
        await refreshing;
        store.dispose();
        store.initialize();
        expect((await store.openSession(other.id)).ok).toBe(true);
        finishRefresh({ ...session, updatedAt: 2, transcription: { language: 'en' } });
        await run;
        expect(store.workspace.activeSession?.id).toBe(other.id);
        expect(store.workspace.activeSession?.updatedAt).toBe(3);
        expect(store.workspace.activeSession?.transcription?.language).toBe('de');
        expect(store.transcription.plainText).toBe('Previous transcript');
    } finally {
        store.dispose();
    }
});
