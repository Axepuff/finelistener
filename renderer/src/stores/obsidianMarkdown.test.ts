import { expect, it } from 'vitest';
import type { SessionTranscriptV1 } from 'electron/src/types/sessions';
import { formatObsidianNote } from './obsidianMarkdown';

it('exports only the saved partial speech with start times when speakers are unavailable', () => {
    const note = formatObsidianNote('Meeting.m4a', {
        version: 1,
        segments: [{ startSec: 75, endSec: null, text: 'Open ![[private]]', source: 'microphone' }],
        recognitionSegments: [{ startSec: 74, endSec: 75, text: 'Hidden duplicate' }],
        sourceRun: { status: 'incomplete', settings: { language: 'en' }, sources: [] },
    }, { plain: false, timestamped: true });

    expect(note).toBe('# Meeting\n\n**Partial transcript**\n\n## Timestamped transcript\n\n[01:15] Open !\\[\\[private\\]\\]\n');
});

it('includes both requested views and summaries with escaped titles, source text, and saved speaker names', () => {
    const input: SessionTranscriptV1 = {
        version: 1,
        segments: [
            { startSec: 3600, endSec: 3601, speakerId: 'A', text: 'Добрый' },
            { startSec: 3601, endSec: 3602, speakerId: 'A', text: 'день.' },
            { startSec: 3603, endSec: 3604, speakerId: null, text: '<Да>.' },
        ],
        speakers: { version: 1, generation: 'g', recognitionRevision: 'r', status: 'completed', settings: {},
            intervals: [], corrections: [], speakers: [{ id: 'A', name: '[[Анна]]' }] },
        summary: { model: 'm', inputHash: 'h', brief: 'Встреча.\n## Heading', detailed: 'Обсудили сроки.',
            reviewedChunks: [{ startSec: 3600, endSec: 3604, text: 'Обсудили сроки.', title: 'План *А*' }] },
    };

    const note = formatObsidianNote('Встреча #1.WAV', input, { plain: true, timestamped: true });
    expect(note).toContain('# Встреча \\#1\n\n## Brief overview\n\nВстреча.\n\\#\\# Heading');
    expect(note).toContain('## Detailed notes\n\n### План \\*А\\*\n\n01:00:00 – 01:00:04\n\nОбсудили сроки.');
    expect(note).toContain('## Plain text\n\nДобрый день. \\<Да\\>.');
    expect(note).toContain('## Timestamped transcript\n\n[01:00:00] \\[\\[Анна\\]\\]: Добрый день.\n\n[01:00:03] Unknown speaker: \\<Да\\>.');
});

it('keeps older detailed-only summaries and paragraph breaks in the plain view', () => {
    const note = formatObsidianNote('Interview.mp3', {
        version: 1,
        summary: { model: 'm', inputHash: 'h', brief: '', detailed: 'Legacy notes.' },
        segments: [{ startSec: 0, endSec: 30, text: 'One thought. '.repeat(30) }],
    }, { plain: true, timestamped: false });

    expect(note).toContain('## Detailed notes\n\nLegacy notes.\n\n## Plain text\n\nOne thought.');
    expect(note).toMatch(/thought\.\n\nOne thought\./u);
    expect(note).not.toContain('## Brief overview');
    expect(note).not.toContain('## Timestamped transcript');
});
