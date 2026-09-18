import type { SessionListItem, SessionTranscriptSegmentV1 } from 'electron/src/types/sessions';
import { expectTypeOf, it } from 'vitest';
import type { TranscriptionStore } from './transcriptionStore';
import type { WorkspaceStore } from './workspaceStore';

it('exposes workspace state as read-only properties and nested data', () => {
    type PlaybackState = Pick<WorkspaceStore,
        | 'sessionsLoading'
        | 'sessionsLoadError'
        | 'audioMode'
        | 'isPlaying'
        | 'isPlayerLoading'
        | 'playbackPosition'
        | 'requestedPlaybackTime'
    >;

    expectTypeOf<PlaybackState>().toEqualTypeOf<Readonly<PlaybackState>>();
    expectTypeOf<WorkspaceStore['sessions']>().toEqualTypeOf<readonly Readonly<SessionListItem>[]>();
    type ActiveSession = NonNullable<WorkspaceStore['activeSession']>;

    expectTypeOf<ActiveSession>().toEqualTypeOf<Readonly<ActiveSession>>();
});

it('exposes transcription state and transcript segments as read-only data', () => {
    type RunState = Pick<TranscriptionStore, 'progress' | 'runOutcome' | 'runErrorMessage'>;
    interface TranscriptView {
        readonly version: 1;
        readonly segments: readonly Readonly<SessionTranscriptSegmentV1>[];
    }

    expectTypeOf<RunState>().toEqualTypeOf<Readonly<RunState>>();
    expectTypeOf<TranscriptionStore['savedTranscript']>().toEqualTypeOf<TranscriptView | null>();
    expectTypeOf<TranscriptionStore['draftTranscript']>().toEqualTypeOf<TranscriptView | null>();
    expectTypeOf<TranscriptionStore['visibleTranscript']>().toEqualTypeOf<TranscriptView | null>();
    expectTypeOf<NonNullable<WorkspaceStore['activeSession']>['transcript']>()
        .toEqualTypeOf<TranscriptView | undefined>();
});
