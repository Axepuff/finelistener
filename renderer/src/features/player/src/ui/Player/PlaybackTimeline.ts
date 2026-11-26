import Timeline from 'wavesurfer.js/dist/plugins/timeline.esm.js';

const LABEL_STEPS_SECONDS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
const MIN_LABEL_SPACING_PX = 84;

export class PlaybackTimeline extends Timeline {
    constructor() {
        super({
            height: 20,
            style: { fontSize: '10px', fontFamily: 'var(--brand-font-family-code)', color: 'var(--brand-color-text-secondary)' },
        });
    }

    override onInit(): void {
        const player = this.wavesurfer!;
        const updateIntervals = () => {
            const duration = player.getDuration();
            const width = player.getWidth();
            if (!width || !Number.isFinite(duration) || duration <= 0) return;

            const minimumStep = Math.max(Math.min(5, duration / 3), duration * MIN_LABEL_SPACING_PX / width);
            const step = LABEL_STEPS_SECONDS.find((seconds) => seconds >= minimumStep) ?? 3600 * Math.ceil(minimumStep / 3600);
            this.options.timeInterval = Math.max(1, step / 5);
            this.options.primaryLabelInterval = step;
            this.options.secondaryLabelInterval = step;
            this.options.formatTimeCallback = (seconds) => {
                const minutes = Math.floor(seconds / 60);
                const label = `${String(minutes).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
                // The plugin anchors labels at their left edge, including the last visible tick.
                return width * (1 - seconds / duration) >= label.length * 7 + 4 ? label : '';
            };
        };

        // Update before the timeline plugin draws its ticks, including on a container resize.
        this.subscriptions.push(player.on('redraw', updateIntervals));
        updateIntervals();
        super.onInit();
    }
}
