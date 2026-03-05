import {
    evaluateTranscriptionWorkflow,
    type TranscriptionRunOutcome,
    type TranscriptionWorkflowSnapshot,
} from '@~/transcribe-state/src/model/transcriptionWorkflow';
import type { SessionDetails, SessionListItem } from 'electron/src/types/sessions';
import { atom } from 'jotai';

export type UiState = 'initial' | 'transcribing' | 'ready';
export type RegionTiming = { start: number; end: number };
export type TrimRange = { start?: number; end?: number };

class TranscriptionAtoms {
    readonly transcribedRegions = atom<RegionTiming | undefined>(undefined);
    readonly currentTime = atom(0);
    readonly log = atom('');
    readonly plainText = atom('');
    readonly renderedText = atom('');
    readonly audioToTranscribe = atom<string[]>([]);
    readonly trimRange = atom<TrimRange | undefined>(undefined);
    readonly runOutcome = atom<TranscriptionRunOutcome>('none');
    readonly runErrorMessage = atom<string | null>(null);
}

class AppState {
    readonly uiState = atom<UiState>('initial');
}

class PlayerAtoms { // TODO remove this global atom
    readonly isPlaying = atom(false);
}

class SessionsAtoms {
    // Currently opened persisted audio session.
    readonly currentSessionId = atom<string | null>(null);
    // Full details of the currently opened session (updated on open/import).
    readonly currentSessionDetails = atom<SessionDetails | null>(null);
    // Whether the player/transcription uses the original or optimized WAV.
    readonly audioMode = atom<'original' | 'optimized'>('original');
    // Sessions list displayed in the right sidebar.
    readonly items = atom<SessionListItem[]>([]);
    readonly isLoading = atom(false);
    readonly loadError = atom<string | null>(null);
}

class AtomRegistry {
    readonly transcription = new TranscriptionAtoms();
    readonly appState = new AppState();
    readonly player = new PlayerAtoms();
    readonly sessions = new SessionsAtoms();
    readonly transcriptionWorkflow = atom<TranscriptionWorkflowSnapshot>((get) => {
        const uiState = get(this.appState.uiState);
        const audioToTranscribe = get(this.transcription.audioToTranscribe);
        const renderedText = get(this.transcription.renderedText);
        const runOutcome = get(this.transcription.runOutcome);

        return evaluateTranscriptionWorkflow({
            lifecycleState: uiState,
            hasAudioSource: audioToTranscribe.length > 0,
            hasRenderedOutput: renderedText.trim().length > 0,
            runOutcome,
        });
    });

    readonly reset = atom(null, (_, set) => {
        set(this.appState.uiState, 'initial');
        set(this.transcription.transcribedRegions, undefined);
        set(this.transcription.currentTime, 0);
        set(this.transcription.log, '');
        set(this.transcription.plainText, '');
        set(this.transcription.renderedText, '');
        set(this.transcription.trimRange, undefined);
        set(this.transcription.runOutcome, 'none');
        set(this.transcription.runErrorMessage, null);
        set(this.sessions.currentSessionId, null);
        set(this.sessions.currentSessionDetails, null);
        set(this.sessions.audioMode, 'original');
        set(this.player.isPlaying, false);
    });

    readonly clearTranscriptionOutput = atom(null, (_, set) => {
        set(this.transcription.transcribedRegions, undefined);
        set(this.transcription.currentTime, 0);
        set(this.transcription.plainText, '');
        set(this.transcription.renderedText, '');
        set(this.transcription.trimRange, undefined);
        set(this.transcription.runOutcome, 'none');
        set(this.transcription.runErrorMessage, null);
    });

    readonly importAudioSession = atom(null, async (_get, set) => {
        const api = window.api;

        if (!api?.sessions?.importAudio) {
            return null;
        }

        const session = await api.sessions.importAudio();

        if (!session) {
            return null;
        }

        set(this.clearTranscriptionOutput);
        set(this.sessions.currentSessionId, session.id);
        set(this.sessions.currentSessionDetails, session);
        set(this.sessions.audioMode, 'original');
        set(this.transcription.audioToTranscribe, [session.audioWavPath]);
        void set(this.refreshSessions);

        return session;
    });

    readonly refreshSessions = atom(null, async (_get, set) => {
        const api = window.api;

        if (!api?.sessions?.list) {
            set(this.sessions.items, []);
            set(this.sessions.isLoading, false);
            set(this.sessions.loadError, null);

            return;
        }

        set(this.sessions.isLoading, true);
        set(this.sessions.loadError, null);

        try {
            const items = await api.sessions.list();

            set(this.sessions.items, items);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            set(this.sessions.loadError, message);
        } finally {
            set(this.sessions.isLoading, false);
        }
    });
}

export const atoms = new AtomRegistry();
