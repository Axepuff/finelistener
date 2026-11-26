import type { RegionBounds } from '@~/player/src/ui/Player/PlayerAdapter';
import type { SessionWaveformPeaks } from 'electron/src/types/sessions';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import { PlaybackTimeline } from './PlaybackTimeline';

const DEFAULT_REGION_LENGTH_SECONDS = 0.01;

export type WaveformStatus = 'loading' | 'ready' | 'waveform-error' | 'audio-error';

interface PlayerCallbacks {
    onPlayingChange: (playing: boolean) => void;
    onDuration: (duration: number) => void;
    onStatus: (status: WaveformStatus) => void;
    onTimeUpdate: (time: number) => void;
    onRegionChange: (bounds: Required<RegionBounds>) => void;
}

export class WaveSurferAdapter {
    private readonly wavesurfer: WaveSurfer;
    private readonly regions: RegionsPlugin;
    private readonly media = document.createElement('audio');
    private peaks?: Float32Array;
    private disposed = false;
    private regionEditing = true;

    constructor(
        containerRef: HTMLDivElement,
        source: { url: string; waveform: Promise<SessionWaveformPeaks> },
        private readonly callbacks: PlayerCallbacks,
    ) {
        const regions = RegionsPlugin.create();
        const timeline = new PlaybackTimeline();

        this.media.preload = 'metadata';
        containerRef.append(this.media);
        this.wavesurfer = WaveSurfer.create({
            container: containerRef,
            media: this.media,
            height: 80,
            waveColor: 'rgba(224, 13, 13, 1)',
            progressColor: 'rgba(194, 72, 15, 1)',
            cursorColor: 'var(--brand-color-info)',
            cursorWidth: 1,
            normalize: true,
            dragToSeek: true,
            barWidth: 1,
            plugins: [timeline, regions],
        });
        this.regions = regions;
        regions.on('region-update', ({ start, end }) => {
            callbacks.onRegionChange({ start, end });
        });
        this.wavesurfer.on('play', () => callbacks.onPlayingChange(true));
        this.wavesurfer.on('pause', () => callbacks.onPlayingChange(false));
        this.wavesurfer.on('finish', () => callbacks.onPlayingChange(false));
        this.wavesurfer.on('timeupdate', callbacks.onTimeUpdate);
        this.wavesurfer.on('interaction', callbacks.onTimeUpdate);
        this.wavesurfer.on('seeking', callbacks.onTimeUpdate);
        this.media.onloadedmetadata = () => {
            callbacks.onDuration(this.duration);
            void this.drawWaveform();
        };
        this.media.onerror = () => {
            console.error('Failed to load playback audio', this.media.error);
            callbacks.onPlayingChange(false);
            callbacks.onDuration(0);
            callbacks.onStatus('audio-error');
        };
        this.media.src = source.url;
        void source.waveform.then(({ peaks }) => {
            if (this.disposed || this.media.error) return;
            this.peaks = peaks;
            return this.drawWaveform();
        }).catch((error: unknown) => this.reportWaveformError(error));
    }

    public get currentTime(): number {
        return this.wavesurfer.getCurrentTime();
    }

    public get duration(): number {
        return Number.isFinite(this.media.duration) ? this.media.duration : 0;
    }

    public get isPlaying(): boolean {
        return this.wavesurfer.isPlaying();
    }

    private async drawWaveform(): Promise<void> {
        if (!this.duration || this.disposed || this.media.error) return;
        try {
            // A blank envelope makes the timeline interactive as soon as the media header arrives.
            const peaks = this.peaks;
            await this.wavesurfer.load(this.media.currentSrc, [peaks ?? [0]], this.duration);
            if (peaks && !this.disposed && !this.media.error) this.callbacks.onStatus('ready');
        } catch (error: unknown) {
            this.reportWaveformError(error);
        }
    }

    private reportWaveformError(error: unknown): void {
        if (this.disposed || this.media.error) return;
        console.error('Failed to load the waveform', error);
        this.callbacks.onStatus('waveform-error');
    }

    async playPause(): Promise<void> {
        if (this.duration) await this.wavesurfer.playPause();
    }

    seekTo(time: number): void {
        if (!this.duration) return;
        this.wavesurfer.setTime(time);
    }

    setRegionEditing(enabled: boolean): void {
        this.regionEditing = enabled;
        for (const region of this.regions.getRegions()) region.setOptions({ resize: enabled });
    }

    setRegion(bounds: RegionBounds): void {
        if (!this.regionEditing) return;
        const existedRegions = this.regions.getRegions();

        if (existedRegions.length > 0) {
            const region = existedRegions[0];

            region.setOptions({
                start: typeof bounds.start === 'number' ? bounds.start : region.start,
                end: typeof bounds.end === 'number' ? bounds.end : region.end,
            });

            return;
        }

        const duration = this.wavesurfer.getDuration();

        if (!Number.isFinite(duration) || duration <= 0) {
            return;
        }

        const requestedStart = typeof bounds.start === 'number' ? bounds.start : 0;
        const requestedEnd = typeof bounds.end === 'number' ? bounds.end : requestedStart;
        const safeStart = Math.max(0, Math.min(requestedStart, duration));
        const safeEnd = Math.max(0, Math.min(requestedEnd, duration));
        const minLength = Math.min(DEFAULT_REGION_LENGTH_SECONDS, duration);
        let regionStart = safeStart;
        let regionEnd = safeEnd;

        if (regionEnd <= regionStart) {
            if (safeStart + minLength <= duration) {
                regionEnd = safeStart + minLength;
            } else {
                regionStart = Math.max(0, safeStart - minLength);
                regionEnd = safeStart;
            }
        }

        this.regions.addRegion({
            start: regionStart,
            end: regionEnd,
            color: 'var(--brand-color-info-bg)',
            drag: false,
            resize: this.regionEditing,
            content: '',
        });
    }

    clearRegions(): void {
        this.regions.clearRegions();
    }

    destroy(): void {
        this.disposed = true;
        this.media.onloadedmetadata = null;
        this.media.onerror = null;
        this.wavesurfer.destroy();
        this.media.pause();
        this.media.removeAttribute('src');
        this.media.load();
        this.media.remove();
    }
}
