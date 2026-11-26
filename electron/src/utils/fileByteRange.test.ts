import { expect, it } from 'vitest';
import { getFileByteRange } from './fileByteRange';

it.each([
    ['bytes=0-', 100, { start: 0, end: 99 }],
    ['bytes=90-', 100, { start: 90, end: 99 }],
    ['bytes=10-20', 100, { start: 10, end: 20 }],
    ['bytes=90-150', 100, { start: 90, end: 99 }],
    ['bytes=-10', 100, { start: 90, end: 99 }],
    ['bytes=-150', 100, { start: 0, end: 99 }],
    ['bytes=100-', 100, null],
    ['bytes=50-25', 100, null],
    ['bytes=-0', 100, null],
    ['bytes=0-', 0, null],
    ['bytes=-', 100, null],
] as const)('resolves %s for a %i byte file', (header, size, expected) => {
    expect(getFileByteRange(header, size)).toEqual(expected);
});
