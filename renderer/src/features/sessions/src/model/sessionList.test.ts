import type { SessionListItem } from 'electron/src/types/sessions';
import { expect, it } from 'vitest';
import { formatSessionMeta, groupSessions } from './sessionList';

const item = (id: string, date: Date, title = id): SessionListItem => ({ id, title, createdAt: date.getTime(), updatedAt: date.getTime(), sourceKind: 'imported', hasTranscript: false });

it('groups local calendar dates across the year boundary, newest first, and filters titles', () => {
    const now = new Date(2027, 0, 1, 12);
    const items = [item('old', new Date(2026, 11, 29), 'Interview'), item('yesterday', new Date(2026, 11, 31, 23)), item('morning', new Date(2027, 0, 1, 9)), item('noon', now, 'INTERVIEW notes')];
    expect(groupSessions(items, '', now).map(({ label, items: rows }) => [label, rows.map(({ id }) => id)])).toEqual([
        ['Today', ['noon', 'morning']], ['Yesterday', ['yesterday']], ['Earlier', ['old']],
    ]);
    expect(groupSessions(items, '  interview ', now).map(({ label, items: rows }) => [label, rows.map(({ id }) => id)])).toEqual([
        ['Today', ['noon']], ['Earlier', ['old']],
    ]);
    expect(groupSessions(items, 'missing', now)).toEqual([]);
});

it.each([
    [{ durationMs: 192000, speakerCount: 3 }, '03:12 · 3 speakers'],
    [{ durationMs: 3734000, speakerCount: 1 }, '1:02:14 · 1 speaker'],
    [{ speakerCount: 2 }, '2 speakers'],
    [{ durationMs: -1 }, 'Imported'],
    [{ sourceKind: 'recorded' as const }, 'Recorded'],
])('formats known session metadata without inventing missing values: %j', (metadata, expected) => {
    expect(formatSessionMeta({ ...item('audio', new Date(0)), ...metadata })).toBe(expected);
});
