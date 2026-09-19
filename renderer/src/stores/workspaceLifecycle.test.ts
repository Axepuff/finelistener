import type { SessionDetails } from 'electron/src/types/sessions';
import { autorun } from 'mobx';
import { expect, it } from 'vitest';
import { AppStore } from './appStore';
import { createFakeRendererAdapter } from './testing/fakeRendererAdapter';

const session: SessionDetails = {
    id: 'session-1', title: 'Audio', createdAt: 1, updatedAt: 1,
    sourceKind: 'imported', hasTranscript: true,
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
