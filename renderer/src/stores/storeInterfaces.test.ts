import type { SessionDetails, SessionListItem, SessionTranscriptSegmentV1, SessionSourceRun } from 'electron/src/types/sessions';
import type { DeepReadonly } from './types';
import { expectTypeOf, it } from 'vitest';
import type { TranscriptionStore } from './transcriptionStore';
import type { SessionsStore } from './sessionsStore';
import type { WorkspaceStore } from './workspaceStore';

it('exposes workspace state as read-only properties and nested data', () => {
    type PlaybackState = Pick<WorkspaceStore,
        | 'audioMode'
        | 'isPlaying'
        | 'isPlayerLoading'
        | 'playbackPosition'
        | 'requestedPlaybackTime'
    >;

    expectTypeOf<PlaybackState>().toEqualTypeOf<Readonly<PlaybackState>>();
    type ActiveSession = NonNullable<WorkspaceStore['activeSession']>;

    expectTypeOf<ActiveSession>().toEqualTypeOf<Readonly<ActiveSession>>();
    expectTypeOf<ActiveSession>().toEqualTypeOf<DeepReadonly<Omit<SessionDetails, 'transcript' | 'hasTranscript'>>>();
});

it('exposes session list state as read-only data', () => {
    type SessionState = Pick<SessionsStore, 'items' | 'isLoading' | 'error'>;

    expectTypeOf<SessionState>().toEqualTypeOf<Readonly<SessionState>>();
    expectTypeOf<SessionsStore['items']>().toEqualTypeOf<readonly Readonly<SessionListItem>[]>();
});

it('exposes transcription state and transcript segments as read-only data', () => {
    type RunState = Pick<TranscriptionStore, 'progress' | 'runOutcome' | 'runErrorMessage'>;
    interface TranscriptView {
        readonly version: 1;
        readonly sourceRun?: DeepReadonly<SessionSourceRun>;
        readonly segments: readonly Readonly<SessionTranscriptSegmentV1>[];
    }

    expectTypeOf<RunState>().toEqualTypeOf<Readonly<RunState>>();
    expectTypeOf<TranscriptionStore['savedTranscript']>().toEqualTypeOf<TranscriptView | null>();
    expectTypeOf<TranscriptionStore['draftTranscript']>().toEqualTypeOf<TranscriptView | null>();
    expectTypeOf<TranscriptionStore['visibleTranscript']>().toEqualTypeOf<TranscriptView | null>();
});
