import {
    evaluateTranscriptionWorkflow,
    type TranscriptionRunOutcome,
    type TranscriptionWorkflowSnapshot,
} from '@~/transcribe-state/src/model/transcriptionWorkflow';
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

class AtomRegistry {
    readonly transcription = new TranscriptionAtoms();
    readonly appState = new AppState();
    readonly player = new PlayerAtoms();
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
        set(this.player.isPlaying, false);
    });
}

export const atoms = new AtomRegistry();
