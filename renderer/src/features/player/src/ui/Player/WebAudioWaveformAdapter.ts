import { PlayerAdapter } from './PlayerAdapter';

interface WebAudioWaveformAdapterOptions {
    waveColor?: string;
    progressColor?: string;
}

interface RegionBounds {
    start?: number;
    end?: number;
}

const LOCAL_FILE_PROTOCOL = 'local-file';
const DEFAULT_WAVE_COLOR = 'rgba(224, 13, 13, 1)';
const DEFAULT_PROGRESS_COLOR = 'rgba(194, 72, 15, 1)';
const DEFAULT_REGION_COLOR = 'rgba(231, 255, 20, 0.2)';
const MAX_DOWNSAMPLE_POINTS = 1024;

const buildLocalFileUrl = (filePath: string): string => {
    if (!filePath) return '';

    const normalizedPath = filePath.replace(/\\/g, '/');
    const withLeadingSlash = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;

    return `${LOCAL_FILE_PROTOCOL}://${encodeURI(withLeadingSlash)}`;
};

const isFetchableUrl = (value: string): boolean => {
    if (value.includes('://')) return true;

    return value.startsWith('data:') || value.startsWith('blob:');
};

export class WebAudioWaveformAdapter extends PlayerAdapter {
    private readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D;
    private readonly waveColor: string;
    private readonly progressColor: string;
    private audioContext: AudioContext | null = null;
    private audioBuffer: AudioBuffer | null = null;
    private sourceNode: AudioBufferSourceNode | null = null;
    private playbackStartTime = 0;
    private pausedAt = 0;
    private isPlayingInternal = false;
    private animationFrameId: number | null = null;
    private waveformData: Float32Array | null = null;
    private waveformImageData: ImageData | null = null;
    private waveformImageSize: { width: number; height: number } | null = null;
    private region: RegionBounds | null = null;

    // Drive progress line updates while audio is playing.
    private readonly animationTick = () => {
        if (!this.isPlayingInternal) return;
        this.draw();
        this.animationFrameId = requestAnimationFrame(this.animationTick);
    };

    constructor(canvas: HTMLCanvasElement, options?: WebAudioWaveformAdapterOptions) {
        super();
        this.canvas = canvas;
        const context = canvas.getContext('2d');

        if (!context) {
            throw new Error('Canvas 2D context is not available');
        }

        this.ctx = context;
        this.waveColor = options?.waveColor ?? DEFAULT_WAVE_COLOR;
        this.progressColor = options?.progressColor ?? DEFAULT_PROGRESS_COLOR;

        this.syncCanvasSize();
        this.clearCanvas();
    }

    public get currentTime(): number {
        if (!this.audioBuffer) return 0;
        if (!this.audioContext || !this.isPlayingInternal) return this.pausedAt;

        const elapsed = this.audioContext.currentTime - this.playbackStartTime;

        return Math.min(Math.max(elapsed, 0), this.audioBuffer.duration);
    }

    public get isPlaying(): boolean {
        return this.isPlayingInternal;
    }

    public async loadSource(source?: string | File): Promise<void> {
        console.log(source);

        this.resetPlaybackState();
        this.audioBuffer = null;
        this.waveformData = null;
        this.waveformImageData = null;
        this.region = null;
        this.clearCanvas();

        if (!source) return;

        try {
            const arrayBuffer = await this.loadArrayBuffer(source);
            const audioContext = this.getAudioContext();
            const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));

            this.audioBuffer = decodedBuffer;
            this.waveformData = this.buildWaveformData(decodedBuffer);
            this.region = {
                start: 0,
                end: Math.min(1, decodedBuffer.duration),
            };
            this.renderWaveformImage();
            this.draw();
        } catch (error) {
            console.error('Failed to load audio source', error);
            this.resetPlaybackState();
            this.audioBuffer = null;
            this.waveformData = null;
            this.waveformImageData = null;
            this.region = null;
            this.clearCanvas();
        }
    }

    public async playPause(): Promise<void> {
        if (!this.audioBuffer) return;

        const audioContext = this.getAudioContext();

        if (audioContext.state === 'suspended') {
            try {
                await audioContext.resume();
            } catch (error) {
                console.error('Failed to resume AudioContext', error);
            }
        }

        if (this.isPlayingInternal) {
            this.pausePlayback();

            return;
        }

        this.startPlaybackFrom(this.pausedAt);
    }

    public seekTo(time: number): void {
        if (!this.audioBuffer) return;

        const safeTime = this.clampTime(time, this.audioBuffer.duration);

        this.pausedAt = safeTime;

        if (this.isPlayingInternal) {
            this.startPlaybackFrom(safeTime);

            return;
        }

        this.draw();
    }

    public setRegion(bounds: RegionBounds): void {
        if (!this.audioBuffer) return;

        const currentRegion = this.region ?? {
            start: 0,
            end: Math.min(1, this.audioBuffer.duration),
        };
        const start =
            typeof bounds.start === 'number'
                ? this.clampTime(bounds.start, this.audioBuffer.duration)
                : currentRegion.start;
        const end =
            typeof bounds.end === 'number'
                ? this.clampTime(bounds.end, this.audioBuffer.duration)
                : currentRegion.end;

        this.region = {
            start,
            end,
        };
        this.draw();
    }

    public clearRegions(): void {
        this.region = null;
        this.draw();
    }

    public destroy(): void {
        this.resetPlaybackState();
        this.audioBuffer = null;
        this.waveformData = null;
        this.waveformImageData = null;
        this.region = null;
        this.clearCanvas();

        if (this.audioContext) {
            void this.audioContext.close();
            this.audioContext = null;
        }
    }

    private getAudioContext(): AudioContext {
        if (this.audioContext) return this.audioContext;

        const AudioContextConstructor =
            window.AudioContext ||
            (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

        if (!AudioContextConstructor) {
            throw new Error('AudioContext is not supported in this environment');
        }

        this.audioContext = new AudioContextConstructor();

        return this.audioContext;
    }

    private async loadArrayBuffer(source: string | File): Promise<ArrayBuffer> {
        if (typeof source === 'string') {
            const fetchUrl = isFetchableUrl(source) ? source : buildLocalFileUrl(source);
            const response = await fetch(fetchUrl);

            if (!response.ok) {
                throw new Error(`Failed to fetch audio source: ${response.status}`);
            }

            return response.arrayBuffer();
        }

        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onerror = () => {
                reject(reader.error ?? new Error('Failed to read file'));
            };

            reader.onload = () => {
                if (reader.result instanceof ArrayBuffer) {
                    resolve(reader.result);

                    return;
                }

                reject(new Error('Unexpected FileReader result'));
            };

            reader.readAsArrayBuffer(source);
        });
    }

    // Downsample buffer into peaks and normalize for fast drawing.
    private buildWaveformData(buffer: AudioBuffer): Float32Array {
        const channels = buffer.numberOfChannels;
        const left = buffer.getChannelData(0);
        const right = channels > 1 ? buffer.getChannelData(1) : null;
        const samples = buffer.length;
        const points = Math.min(MAX_DOWNSAMPLE_POINTS, samples);
        const blockSize = Math.floor(samples / points) || 1;
        const peaks = new Float32Array(points);
        let globalMax = 0;

        for (let i = 0; i < points; i += 1) {
            const start = i * blockSize;
            const end = Math.min(start + blockSize, samples);
            let max = 0;

            for (let j = start; j < end; j += 1) {
                const leftSample = left[j];
                const rightSample = right ? right[j] : leftSample;
                const amplitude = Math.max(Math.abs(leftSample), Math.abs(rightSample));

                if (amplitude > max) {
                    max = amplitude;
                }
            }

            peaks[i] = max;
            if (max > globalMax) {
                globalMax = max;
            }
        }

        if (globalMax > 0) {
            for (let i = 0; i < peaks.length; i += 1) {
                peaks[i] /= globalMax;
            }
        }

        return peaks;
    }

    // Render waveform once and cache pixel data for fast redraws.
    private renderWaveformImage(): void {
        if (!this.waveformData) return;

        this.syncCanvasSize();

        const { width, height } = this.canvas;
        const offscreen = document.createElement('canvas');

        offscreen.width = width;
        offscreen.height = height;
        const offscreenContext = offscreen.getContext('2d');

        if (!offscreenContext) return;

        offscreenContext.clearRect(0, 0, width, height);
        this.drawWaveform(offscreenContext, this.waveformData, width, height);
        this.waveformImageData = offscreenContext.getImageData(0, 0, width, height);
        this.waveformImageSize = { width, height };
    }

    private drawWaveform(
        context: CanvasRenderingContext2D,
        data: Float32Array,
        width: number,
        height: number,
    ): void {
        const centerY = height / 2;
        const maxAmplitude = centerY;

        // eslint-disable-next-line no-param-reassign
        context.strokeStyle = this.waveColor;
        // eslint-disable-next-line no-param-reassign
        context.lineWidth = 1;
        context.beginPath();

        for (let i = 0; i < data.length; i += 1) {
            const amplitude = data[i];
            const x = (i / Math.max(data.length - 1, 1)) * width;
            const yTop = centerY - amplitude * maxAmplitude;
            const yBottom = centerY + amplitude * maxAmplitude;

            context.moveTo(x, yTop);
            context.lineTo(x, yBottom);
        }

        context.stroke();
    }

    // Draw cached waveform plus overlays (region, progress).
    private draw(): void {
        this.syncCanvasSize();

        const { width, height } = this.canvas;

        this.ctx.clearRect(0, 0, width, height);

        if (this.waveformData) {
            if (
                !this.waveformImageData ||
                !this.waveformImageSize ||
                this.waveformImageSize.width !== width ||
                this.waveformImageSize.height !== height
            ) {
                this.renderWaveformImage();
            }
        }

        if (this.waveformImageData) {
            this.ctx.putImageData(this.waveformImageData, 0, 0);
        }

        this.drawRegionOverlay(width, height);
        this.drawProgressLine(width, height);
    }

    private drawRegionOverlay(width: number, height: number): void {
        if (!this.region || !this.audioBuffer) return;
        if (typeof this.region.start !== 'number' || typeof this.region.end !== 'number') return;

        const duration = this.audioBuffer.duration || 1;
        const startX = (this.region.start / duration) * width;
        const endX = (this.region.end / duration) * width;

        if (endX <= startX) return;

        this.ctx.fillStyle = DEFAULT_REGION_COLOR;
        this.ctx.fillRect(startX, 0, endX - startX, height);
    }

    private drawProgressLine(width: number, height: number): void {
        if (!this.audioBuffer) return;

        const duration = this.audioBuffer.duration || 1;
        const progress = this.currentTime / duration;
        const x = Math.min(Math.max(progress * width, 0), width);

        this.ctx.strokeStyle = this.progressColor;
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.moveTo(x, 0);
        this.ctx.lineTo(x, height);
        this.ctx.stroke();
    }

    // Recreate AudioBufferSourceNode for each play/seek.
    private startPlaybackFrom(offset: number): void {
        if (!this.audioBuffer) return;

        const audioContext = this.getAudioContext();
        const duration = this.audioBuffer.duration;
        const safeOffset = offset >= duration ? 0 : this.clampTime(offset, duration);

        this.pausedAt = safeOffset;
        this.stopSourceNode();

        const source = audioContext.createBufferSource();

        source.buffer = this.audioBuffer;
        source.connect(audioContext.destination);
        source.onended = this.handlePlaybackEnded;
        source.start(0, safeOffset);

        this.sourceNode = source;
        this.playbackStartTime = audioContext.currentTime - safeOffset;
        this.isPlayingInternal = true;
        this.startAnimation();
    }

    private pausePlayback(): void {
        if (!this.audioBuffer) return;

        this.pausedAt = this.clampTime(this.currentTime, this.audioBuffer.duration);
        this.isPlayingInternal = false;
        this.stopSourceNode();
        this.stopAnimation();
        this.draw();
    }

    private readonly handlePlaybackEnded = () => {
        this.isPlayingInternal = false;
        this.stopAnimation();

        if (this.audioBuffer) {
            this.pausedAt = this.audioBuffer.duration;
        }

        this.stopSourceNode();
        this.draw();
    };

    private stopSourceNode(): void {
        if (!this.sourceNode) return;

        this.sourceNode.onended = null;
        try {
            this.sourceNode.stop();
        } catch {
            // ignore if already stopped
        }
        this.sourceNode.disconnect();
        this.sourceNode = null;
    }

    private startAnimation(): void {
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
        }
        this.animationFrameId = requestAnimationFrame(this.animationTick);
    }

    private stopAnimation(): void {
        if (this.animationFrameId === null) return;
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
    }

    private resetPlaybackState(): void {
        this.stopAnimation();
        this.stopSourceNode();
        this.isPlayingInternal = false;
        this.pausedAt = 0;
        this.playbackStartTime = 0;
    }

    private clampTime(time: number, duration: number): number {
        if (!Number.isFinite(time)) return 0;

        return Math.min(Math.max(time, 0), duration);
    }

    private syncCanvasSize(): void {
        const width = Math.max(1, Math.floor(this.canvas.clientWidth || this.canvas.width || 1));
        const height = Math.max(1, Math.floor(this.canvas.clientHeight || this.canvas.height || 1));

        if (this.canvas.width === width && this.canvas.height === height) return;

        this.canvas.width = width;
        this.canvas.height = height;
        this.waveformImageData = null;
        this.waveformImageSize = null;
    }

    private clearCanvas(): void {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
}
