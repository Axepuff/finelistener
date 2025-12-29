import { PlayerAdapter, type RegionBounds } from '@~/player/src/ui/Player/PlayerAdapter';
import { atom } from 'jotai';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import Timeline from 'wavesurfer.js/dist/plugins/timeline.esm.js';

const LOCAL_FILE_PROTOCOL = 'local-file';

const buildLocalFileUrl = (filePath: string): string => {
    if (!filePath) return '';

    const normalizedPath = filePath.replace(/\\/g, '/');
    const withLeadingSlash = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;

    return `${LOCAL_FILE_PROTOCOL}://${encodeURI(withLeadingSlash)}`;
};

export const isPlayingAtom = atom(false);

export class WaveSurferAdapter extends PlayerAdapter {
    private readonly wavesurfer: WaveSurfer;
    private readonly regions: RegionsPlugin;
    private hasInitialRegion = false;
    private readonly onPlayingChange: (isPlaying: boolean) => void;
    private readonly onTimeUpdate: (time: number) => void;
    private readonly onReadyChange: (isPlaying: boolean) => void;
    private readonly handleDecode = (): void => {
        if (this.hasInitialRegion) return;

        this.regions.addRegion({
            start: 0,
            end: 1,
            color: 'rgba(231, 255, 20, 0.2)',
            drag: false,
            resize: true,
            content: '',
        });

        this.hasInitialRegion = true;
    };
    private readonly handlePlay = (): void => {
        this.onPlayingChange(true);
    };
    private readonly handlePause = (): void => {
        this.onPlayingChange(false);
    };
    private readonly handleReady = (): void => {
        this.onReadyChange(false);
    };
    private readonly handleTimeUpdate = (currentTime: number): void => {
        this.onTimeUpdate(currentTime);
    };

    constructor(
        containerRef: HTMLDivElement,
        onPlayingChange: (isPlaying: boolean) => void,
        setIsLoading: (isPlaying: boolean) => void,
        onTimeUpdate: (time: number) => void,
    ) {
        super();
        this.onPlayingChange = onPlayingChange;
        this.onReadyChange = setIsLoading;
        this.onTimeUpdate = onTimeUpdate;
        const regions = RegionsPlugin.create();
        const timeline = Timeline.create();

        this.wavesurfer = WaveSurfer.create({
            container: containerRef,
            height: 100,
            waveColor: 'rgba(224, 13, 13, 1)',
            progressColor: 'rgba(194, 72, 15, 1)',
            cursorColor: '#05044dff',
            normalize: true,
            dragToSeek: true,
            barWidth: 1,
            plugins: [timeline, regions],
        });
        this.regions = regions;

        this.wavesurfer.on('decode', this.handleDecode);
        this.wavesurfer.on('play', this.handlePlay);
        this.wavesurfer.on('pause', this.handlePause);
        this.wavesurfer.on('finish', this.handlePause);
        this.wavesurfer.on('ready', this.handleReady);
        this.wavesurfer.on('timeupdate', this.handleTimeUpdate);
        this.wavesurfer.on('interaction', this.handleTimeUpdate);
        this.wavesurfer.on('seeking', this.handleTimeUpdate);

        this.onPlayingChange(false);
    }

    public get currentTime(): number {
        return this.wavesurfer.getCurrentTime();
    }

    public get isPlaying(): boolean {
        return this.wavesurfer.isPlaying();
    }

    async loadSource(filePath?: string): Promise<void> {
        this.hasInitialRegion = false;
        this.clearRegions();
        this.onPlayingChange(false);
        this.onTimeUpdate(0);

        if (!filePath) return;

        await this.wavesurfer.load(buildLocalFileUrl(filePath));
    }

    async playPause(): Promise<void> {
        await this.wavesurfer.playPause();
    }

    seekTo(time: number): void {
        this.wavesurfer.setTime(time);
        this.onTimeUpdate(time);
    }

    setRegion(bounds: RegionBounds): void {
        const existedRegions = this.regions.getRegions();

        if (existedRegions.length > 0) {
            const region = existedRegions[0];

            region.setOptions({
                start: typeof bounds.start === 'number' ? bounds.start : region.start,
                end: typeof bounds.end === 'number' ? bounds.end : region.end,
            });

            return;
        }
    }

    clearRegions(): void {
        this.regions.clearRegions();
    }

    destroy(): void {
        this.wavesurfer.un('decode', this.handleDecode);
        this.wavesurfer.un('play', this.handlePlay);
        this.wavesurfer.un('pause', this.handlePause);
        this.wavesurfer.un('finish', this.handlePause);
        this.wavesurfer.un('ready', this.handleReady);
        this.wavesurfer.un('timeupdate', this.handleTimeUpdate);
        this.wavesurfer.un('interaction', this.handleTimeUpdate);
        this.wavesurfer.un('seeking', this.handleTimeUpdate);
        this.wavesurfer.destroy();
        this.clearRegions();
        this.onPlayingChange(false);
        this.onReadyChange(true);
    }
}
