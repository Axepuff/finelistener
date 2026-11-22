import { expect, it } from 'vitest';
import { formatPreciseTime } from './formatPreciseTime';

it.each([
    [0, '00:00.00'],
    [59.994, '00:59.99'],
    [59.995, '01:00.00'],
    [59.999, '01:00.00'],
    [60, '01:00.00'],
    [3599.999, '60:00.00'],
    [-1, '00:00.00'],
    [NaN, '00:00.00'],
    [Infinity, '00:00.00'],
])('formats %s seconds as %s', (seconds, expected) => {
    expect(formatPreciseTime(seconds)).toBe(expected);
});
