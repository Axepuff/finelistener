import type { SessionDetails } from 'electron/src/types/sessions';
import { describe, expect, it } from 'vitest';
import { WorkspaceStore } from './workspaceStore';

const session: SessionDetails = {
    id: 'session-1',
    title: 'Audio',
    createdAt: 1,
    updatedAt: 2,
    sourceKind: 'imported',
    hasTranscript: true,
    transcript: { version: 1, segments: [{ startSec: 0, endSec: 1, text: 'Saved' }] },
    audioOriginalPath: '/audio/original.mp3',
    audioWavPath: '/audio/original.wav',
    audioOptimizedWavPath: '/audio/optimized.wav',
};

describe('WorkspaceStore', () => {
    it('keeps session metadata without retaining transcript fields from the IPC object', () => {
        const store = new WorkspaceStore();

        store.replaceWorkspace(session);

        expect(store.activeSession).not.toHaveProperty('transcript');
        expect(store.activeSession).not.toHaveProperty('hasTranscript');
        expect(store.activeSession).toMatchObject({ id: session.id, title: session.title });
        expect(store.audioSourcePath).toBe(session.audioWavPath);
        expect(session.transcript?.segments[0]?.text).toBe('Saved');

        expect(store.useOptimizedAudio(session)).toBe(true);
        expect(store.activeSession).not.toHaveProperty('transcript');
        expect(store.activeSession).not.toHaveProperty('hasTranscript');
        expect(store.audioSourcePath).toBe(session.audioOptimizedWavPath);

        store.useOriginalAudio();
        expect(store.audioSourcePath).toBe(session.audioWavPath);
        expect(store.audioMode).toBe('original');
    });

    it.each(['replace', 'clear', 'original', 'optimized'] as const)(
        'resets segment and playback when applying %s', (command) => {
            const store = new WorkspaceStore();

            store.replaceWorkspace(session);
            store.setSegmentStart(1);
            store.setSegmentEnd(3);
            store.setPlaying(true);
            store.setPlayerLoading(true);
            store.setPlaybackPosition(2);
            store.requestPlaybackTime(2);

            if (command === 'replace') store.replaceWorkspace({ ...session, id: 'session-2' });
            if (command === 'clear') store.clearWorkspace();
            if (command === 'original') store.useOriginalAudio();
            if (command === 'optimized') store.useOptimizedAudio(session);

            expect(store.segmentSelection).toBeNull();
            expect(store.isPlaying).toBe(false);
            expect(store.isPlayerLoading).toBe(false);
            expect(store.playbackPosition).toBe(0);
            expect(store.requestedPlaybackTime).toBe(0);
            if (command === 'clear') {
                expect(store.activeSession).toBeNull();
                expect(store.audioSourcePath).toBeNull();
            }
            if (command === 'replace') expect(store.activeSessionId).toBe('session-2');
        },
    );
});
