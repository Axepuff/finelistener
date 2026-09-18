import type { SessionDetails, SessionListItem } from 'electron/src/types/sessions';
import { makeAutoObservable } from 'mobx';
import type { AudioMode, DeepReadonly, Segment, SegmentSelection } from './types';

export class WorkspaceStore {
    private sessionsValue: SessionListItem[] = [];

    private activeSessionValue: DeepReadonly<SessionDetails> | null = null;

    private audioSourcePathValue: string | null = null;

    private segmentSelectionValue: SegmentSelection | null = null;

    private sessionsLoadingValue = false;

    private sessionsLoadErrorValue: string | null = null;

    private audioModeValue: AudioMode = 'original';

    private isPlayingValue = false;

    private isPlayerLoadingValue = false;

    private playbackPositionValue = 0;

    private requestedPlaybackTimeValue = 0;

    get sessionsLoading(): boolean {
        return this.sessionsLoadingValue;
    }

    get sessionsLoadError(): string | null {
        return this.sessionsLoadErrorValue;
    }

    get audioMode(): AudioMode {
        return this.audioModeValue;
    }

    get isPlaying(): boolean {
        return this.isPlayingValue;
    }

    get isPlayerLoading(): boolean {
        return this.isPlayerLoadingValue;
    }

    get playbackPosition(): number {
        return this.playbackPositionValue;
    }

    get requestedPlaybackTime(): number {
        return this.requestedPlaybackTimeValue;
    }

    constructor() {
        makeAutoObservable(this, {}, { autoBind: true });
    }

    get sessions(): DeepReadonly<SessionListItem[]> {
        return this.sessionsValue;
    }

    get activeSession(): DeepReadonly<SessionDetails> | null {
        return this.activeSessionValue;
    }

    get activeSessionId(): string | null {
        return this.activeSessionValue?.id ?? null;
    }

    get audioSourcePath(): string | null {
        return this.audioSourcePathValue;
    }

    get hasAudioSource(): boolean {
        return this.audioSourcePathValue !== null;
    }

    get segmentSelection(): Readonly<SegmentSelection> | null {
        return this.segmentSelectionValue;
    }

    get selectedSegment(): Segment | null {
        const start = this.segmentSelectionValue?.start;
        const end = this.segmentSelectionValue?.end;

        if (typeof start !== 'number' || typeof end !== 'number') return null;
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;

        return { start, end };
    }

    get hasIncompleteSegment(): boolean {
        return this.segmentSelectionValue !== null && this.selectedSegment === null;
    }

    replaceSessions(sessions: SessionListItem[]): void {
        this.sessionsValue = sessions;
    }

    setSessionsLoading(isLoading: boolean): void {
        this.sessionsLoadingValue = isLoading;
    }

    setSessionsLoadError(message: string | null): void {
        this.sessionsLoadErrorValue = message;
    }

    replaceWorkspace(session: DeepReadonly<SessionDetails>): void {
        this.activeSessionValue = session;
        this.audioModeValue = 'original';
        this.audioSourcePathValue = session.audioWavPath;
        this.resetPlayback();
    }

    updateActiveSession(session: DeepReadonly<SessionDetails>): void {
        if (this.activeSessionValue?.id !== session.id) return;

        this.activeSessionValue = session;
    }

    useOriginalAudio(): void {
        if (!this.activeSessionValue) return;

        this.audioModeValue = 'original';
        this.audioSourcePathValue = this.activeSessionValue.audioWavPath;
        this.resetPlayback();
    }

    useOptimizedAudio(session: DeepReadonly<SessionDetails>): boolean {
        if (!session.audioOptimizedWavPath) return false;

        this.activeSessionValue = session;
        this.audioModeValue = 'optimized';
        this.audioSourcePathValue = session.audioOptimizedWavPath;
        this.resetPlayback();

        return true;
    }

    setSegmentStart(start: number): void {
        const safeStart = Number.isFinite(start) ? Math.max(0, start) : 0;

        this.segmentSelectionValue = {
            start: safeStart,
            end: this.segmentSelectionValue?.end,
        };
    }

    setSegmentEnd(end: number): void {
        if (!Number.isFinite(end)) return;

        this.segmentSelectionValue = {
            start: this.segmentSelectionValue?.start,
            end: Math.max(0, end),
        };
    }

    clearSegment(): void {
        this.segmentSelectionValue = null;
    }

    setPlaying(isPlaying: boolean): void {
        this.isPlayingValue = isPlaying;
    }

    setPlayerLoading(isLoading: boolean): void {
        this.isPlayerLoadingValue = isLoading;
    }

    setPlaybackPosition(position: number): void {
        this.playbackPositionValue = Number.isFinite(position) ? Math.max(0, position) : 0;
    }

    requestPlaybackTime(time: number): void {
        this.requestedPlaybackTimeValue = Number.isFinite(time) ? Math.max(0, time) : 0;
    }

    removeSession(sessionId: string): void {
        this.sessionsValue = this.sessionsValue.filter((session) => session.id !== sessionId);
    }

    clearWorkspace(): void {
        this.activeSessionValue = null;
        this.audioModeValue = 'original';
        this.audioSourcePathValue = null;
        this.resetPlayback();
    }

    private resetPlayback(): void {
        this.segmentSelectionValue = null;
        this.isPlayingValue = false;
        this.isPlayerLoadingValue = false;
        this.playbackPositionValue = 0;
        this.requestedPlaybackTimeValue = 0;
    }
}
