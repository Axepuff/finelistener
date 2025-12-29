export interface RegionBounds {
    start?: number;
    end?: number;
}

export abstract class PlayerAdapter {
    abstract loadSource(filePath?: string): Promise<void>;
    abstract playPause(): Promise<void>;
    abstract seekTo(time: number): void;
    abstract setRegion(bounds: RegionBounds): void;
    abstract clearRegions(): void;
    abstract destroy(): void;
    abstract currentTime: number;
    abstract isPlaying: boolean;
}

