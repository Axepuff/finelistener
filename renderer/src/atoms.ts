import { atom } from 'jotai';

export type UiState = 'initial' | 'transcribing' | 'ready';
export type RegionTiming = { start: number; end: number };

class TranscriptionAtoms {
    readonly regions = atom<RegionTiming | undefined>(undefined);
    readonly transcribedRegions = atom<RegionTiming | undefined>(undefined);
    readonly currentTime = atom(0);
    readonly log = atom('');
    readonly audioToTranscribe = atom<string[]>([]);
}

class AppState {
    readonly uiState = atom<UiState>('initial');
}

class AtomRegistry {
    readonly transcription = new TranscriptionAtoms();
    readonly appState = new AppState();

    readonly reset = atom(null, (_, set) => {
        set(this.appState.uiState, 'initial');
        set(this.transcription.regions, undefined);
        set(this.transcription.transcribedRegions, undefined);
        set(this.transcription.currentTime, 0);
        set(this.transcription.log, '');
        set(this.transcription.audioToTranscribe, []);
    });
}

export const atoms = new AtomRegistry();
