import { expect, it } from 'vitest';
import { ProgressEstimate } from './progressEstimate';

it('rounds observed throughput, suppresses early and stalled estimates, and samples afresh after a stall', () => {
    const estimate = new ProgressEstimate();
    estimate.start(0, 0);
    estimate.update(0.01, 1_000);
    expect(estimate.label(1_000)).toBeNull();
    estimate.update(0.05, 5_000);
    expect(estimate.label(5_000)).toBe('about 2 min left');
    estimate.update(0.05, 19_000);
    expect(estimate.label(20_000)).toBeNull();
    estimate.update(0.5, 23_000);
    expect(estimate.label(23_000)).toBeNull();
    estimate.update(0.6, 27_000);
    expect(estimate.label(27_000)).toBe('less than a minute left');
    estimate.update(1, 28_000);
    expect(estimate.label(28_000)).toBeNull();
});
