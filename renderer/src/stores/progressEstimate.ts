import { makeAutoObservable } from 'mobx';

const warmupMs = 3_000;
const staleMs = 15_000;

export class ProgressEstimate {
    startedAt = 0;
    private sampleSince = 0;
    private lastChange = 0;
    private fraction = 0;
    private rate = 0;

    constructor() {
        makeAutoObservable(this);
    }

    start(fraction = 0, now = Date.now()): void {
        this.startedAt = now;
        this.resetSample(fraction, now);
    }

    private resetSample(fraction: number, now: number): void {
        this.sampleSince = now;
        this.lastChange = now;
        this.fraction = fraction;
        this.rate = 0;
    }

    update(fraction: number, now = Date.now()): void {
        if (!Number.isFinite(fraction) || fraction === this.fraction) return;
        const elapsed = now - this.lastChange;
        if (fraction < this.fraction || elapsed >= staleMs || elapsed < 0) {
            this.resetSample(fraction, now);
            return;
        }
        if (!elapsed) return;
        const rate = (fraction - this.fraction) / elapsed;
        // Weight by elapsed time so frequent network events and sparse Whisper updates use the same smoothing window.
        const weight = 1 - Math.exp(-elapsed / 5_000);
        this.rate = this.rate ? this.rate + weight * (rate - this.rate) : rate;
        this.fraction = fraction;
        this.lastChange = now;
    }

    label(now: number): string | null {
        if (!this.rate || this.fraction >= 1 || now - this.sampleSince < warmupMs || now - this.lastChange >= staleMs) return null;
        const minutes = (1 - this.fraction) / this.rate / 60_000;
        return minutes < 1 ? 'less than a minute left' : `about ${Math.round(minutes)} min left`;
    }
}
