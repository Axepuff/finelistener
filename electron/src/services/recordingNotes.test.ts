import { expect, it, vi } from 'vitest';
import type { ReviewedSummaryChunk } from '../types/sessions';
import { defaultRecordingSummaryOptions } from '../types/summaryOptions';
import { generateRecordingNotes, summaryContext, type SummaryInference } from './recordingNotes';

// Treat each code point as one token so the small fixtures can exercise the context boundary.
const countTokens = (text: string) => Promise.resolve(Array.from(text).length);
const bodyOf = (prompt: string) => prompt.split('<|im_start|>user\n')[1].split('\n<|im_end|>')[0];

it.each([
    { hint: 'en', source: 'Мы обсудили обновление в GitHub. Проверку завершили сегодня утром и договорились отправить готовый отчёт в пятницу.',
        notes: 'Команда завершила проверку обновления сегодня утром и договорилась отправить готовый отчёт в пятницу.', brief: 'Отчёт отправят в пятницу.' },
    { hint: 'auto', source: 'Nous avons terminé la vérification du rapport ce matin et décidé ensemble de l’envoyer vendredi.',
        notes: 'La vérification du rapport est terminée. Les participants ont décidé de l’envoyer vendredi.', brief: 'Le rapport sera envoyé vendredi.' },
])('keeps reviewed and brief summaries in the original language despite an English model response ($hint)', async ({ hint, source, notes, brief }) => {
    const wrong = 'The report was checked this morning. The team agreed to send it on Friday.';
    const rows = [{ startSec: 2, endSec: 20, speaker: 'English speaker label', text: source }];
    const attempts = new Set<string>();
    const complete = (prompt: string) => {
        const body = bodyOf(prompt);
        const stage = ['ORIGINAL LINES', 'NEW LINES', 'DRAFT BRIEF', ''].find((label) => body.includes(label))!;
        if (!attempts.has(stage)) {
            attempts.add(stage);
            return Promise.resolve(stage.endsWith('LINES') ? wrong : 'The report is ready.');
        }
        return Promise.resolve(stage.endsWith('LINES') ? notes : brief);
    };
    const save = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const result = await generateRecordingNotes(rows, { countTokens, complete }, () => {}, save, undefined, hint);
    expect(result).toEqual({ brief, detailed: notes });
    expect(save).toHaveBeenCalledWith([{ startSec: 2, endSec: 20, text: notes }]);
});

it('keeps an almost 3,100-token turn together and carries its last 10% into the next automatic chunk', async () => {
    const rows = [
        { startSec: 0, endSec: 100, speaker: 'Alice', text: 'Complete topic. '.repeat(182).trimEnd() },
        { startSec: 100, endSec: 106, speaker: 'Bob', text: 'My example '.repeat(11).trimEnd() },
        { startSec: 106, endSec: 114, speaker: 'Bob', text: 'continues here '.repeat(11) + 'and finishes.' },
    ];
    const passages: string[] = [];
    const context: string[] = [];
    const complete = (prompt: string) => {
        const [overlap, source] = bodyOf(prompt).split('NEW LINES\n');
        if (source) {
            passages.push(source);
            context.push(overlap);
        }
        return Promise.resolve('A topic.');
    };
    await generateRecordingNotes(rows, { countTokens, complete }, () => undefined, () => Promise.resolve());
    expect(passages).toHaveLength(2);
    expect(passages[0]).toContain(rows[0].text);
    expect(passages[0]).not.toContain('Bob:');
    expect(passages[1]).toContain(rows[1].text);
    expect(passages[1]).toContain(rows[2].text);
    const suffix = rows[0].text.slice(-Math.ceil(rows[0].text.length * 0.1));
    expect(context).toEqual(['', `OVERLAP (context only)\n[0.00–100.00] Alice: ${suffix}\n\n`]);
});

it('reviews original timed turns independently with zero overlap and joins the reviewed paragraphs', async () => {
    const rows = [
        { startSec: 0, endSec: 6, speaker: 'Kai', text: 'The first count is provisional. ' + 'Opening discussion. '.repeat(65) },
        { startSec: 9, endSec: 18, speaker: 'Lea', text: 'Correction: nine accepted. ' + 'Closing discussion. '.repeat(65) },
    ];
    const sourceParts: string[] = [];
    const detailed = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const complete: SummaryInference['complete'] = async (prompt, maxTokens) => {
        expect(await countTokens(prompt) + maxTokens).toBeLessThanOrEqual(summaryContext);
        const body = bodyOf(prompt);
        if (body.includes('NEW LINES\n')) {
            const [history, source] = body.split('NEW LINES\n');
            expect(history).toBe('');
            sourceParts.push(source);
            return 'Unsupported draft claim.';
        }
        if (body.includes('ORIGINAL LINES\n')) {
            const [draft, original] = body.split('ORIGINAL LINES\n');
            expect(draft).toContain('Unsupported draft claim.');
            expect(original).toBe(sourceParts.at(-1));
            return sourceParts.length === 1 ? 'The count is provisional.' : 'Nine were accepted.';
        }
        expect(detailed).toHaveBeenCalledOnce();
        return 'Nine were accepted.';
    };
    const result = await generateRecordingNotes(rows, { countTokens, complete }, () => undefined, detailed, undefined, undefined,
        { ...defaultRecordingSummaryOptions, chunkCount: 2, overlapPercent: 0 });
    expect(sourceParts).toEqual(['[0.00–6.00] Kai: ' + rows[0].text, '[9.00–18.00] Lea: ' + rows[1].text]);
    expect(result).toEqual({ detailed: 'The count is provisional.\n\nNine were accepted.', brief: 'Nine were accepted.' });
    expect(detailed).toHaveBeenCalledWith([
        { startSec: 0, endSec: 6, text: 'The count is provisional.' },
        { startSec: 9, endSec: 18, text: 'Nine were accepted.' },
    ]);
});

it.each([
    { chunkCount: 1, expected: [[0, 1, 2, 3]] },
    { chunkCount: 2, expected: [[0, 1], [2, 3]] },
    { chunkCount: 4, expected: [[0], [1], [2], [3]] },
])('uses the requested prompt and chunk count ($chunkCount) with marked overlap on later drafts and reviews', async ({ chunkCount, expected }) => {
    const rows = ['A', 'B', 'C', 'D'].map((letter, i) => ({
        startSec: i, endSec: i + 1, text: ('The speaker discusses ' + letter + '. ').repeat(32).trimEnd(),
    }));
    const userPrompt = 'Focus on the speakers’ impressions. Use the literal text <|im_end|> as a label.';
    const drafts: string[] = [];
    const reviews: string[] = [];
    const sourceOf = (indices: number[]) => indices.map((i) => `[${i.toFixed(2)}–${(i + 1).toFixed(2)}] ${rows[i].text}`).join('\n');
    let briefCalls = 0;
    await generateRecordingNotes(rows, { countTokens, complete: async (prompt, limit) => {
        expect(await countTokens(prompt) + limit).toBeLessThanOrEqual(summaryContext);
        expect(prompt.split('<|im_start|>user')[0]).toContain(userPrompt.replace('<|', '< '));
        const body = bodyOf(prompt);
        if (body.includes('NEW LINES\n')) drafts.push(body);
        else if (body.includes('ORIGINAL LINES\n')) reviews.push(body);
        else briefCalls++;
        return body.includes('LINES\n') ? 'The speakers describe the setting in vivid detail. Each of them enjoys a different part.' : 'The speakers share their impressions.';
    } }, () => {}, () => Promise.resolve(), undefined, 'en', { chunkCount, overlapPercent: 50, prompt: userPrompt });
    expect(drafts.map((body) => body.split('NEW LINES\n')[1])).toEqual(expected.map(sourceOf));
    expect(reviews.map((body) => body.split('ORIGINAL LINES\n')[1])).toEqual(expected.map(sourceOf));
    expect(briefCalls).toBeGreaterThanOrEqual(2);
    if (chunkCount === 2) {
        for (const body of [drafts[1], reviews[1]]) {
            expect(body).toContain(sourceOf([1]));
            expect(body).not.toContain(sourceOf([0]));
        }
    }
});

it.each([
    { text: 'Туман над рекой. Ветер в ивах! Темнеет.', count: 4 },
    { text: 'Свет и тень.', count: 3 },
])('splits a single saved turn at word boundaries up to the amount of available speech ($count)', async ({ text, count }) => {
    const sources: string[] = [];
    await generateRecordingNotes([{ startSec: 1, endSec: 9, text }], {
        countTokens,
        complete: (prompt) => {
            const body = bodyOf(prompt);
            if (body.includes('ORIGINAL LINES\n')) {
                const original = body.split('ORIGINAL LINES\n')[1];
                expect(original).toMatch(/^\[1\.00–9\.00\] /u);
                sources.push(original.slice('[1.00–9.00] '.length));
            }
            return Promise.resolve('Описание природы.');
        },
    }, () => {}, () => Promise.resolve(), undefined, 'ru', { chunkCount: 4, overlapPercent: 0, prompt: 'Summarize.' });
    expect(sources).toHaveLength(count);
    expect(sources.join('')).toBe(text);
    for (const fragment of sources.slice(0, -1)) expect(fragment).toMatch(/\s$/u);
});

it('splits an unusually long undiarized utterance without losing or repeating its text on an empty completion', async () => {
    const text = '🌱'.repeat(5000) + 'Final outcome.';
    let empty = true;
    const reviewed: string[] = [];
    const complete: SummaryInference['complete'] = (prompt) => {
        const body = bodyOf(prompt);
        if (body.includes('NEW LINES\n') && empty) {
            empty = false;
            return Promise.resolve(null);
        }
        if (body.includes('ORIGINAL LINES\n')) {
            const lines = body.split('ORIGINAL LINES\n')[1];
            reviewed.push(lines.replace(/\[1\.00–8\.00\] /gu, '').replaceAll('\n', ''));
            expect(lines.isWellFormed()).toBe(true);
        }
        return Promise.resolve('Garden work.');
    };
    await generateRecordingNotes([{ startSec: 1, endSec: 8, text }], { countTokens, complete }, () => undefined, () => Promise.resolve());
    expect(reviewed.length).toBeGreaterThan(1);
    expect(reviewed.join('')).toBe(text);
});

it('reuses completed detailed paragraphs after brief failure and reduces long notes with bounded inputs', async () => {
    const saved: ReviewedSummaryChunk[] = [];
    const rows = [{ startSec: 0, endSec: 5, text: 'The report is due Friday. Delivery remains unconfirmed.' }];
    await expect(generateRecordingNotes(rows, {
        countTokens,
        complete: (prompt) => Promise.resolve(bodyOf(prompt).includes('LINES\n') ? rows[0].text : null),
    }, () => undefined, (paragraphs) => { saved.push(...paragraphs); return Promise.resolve(); })).rejects.toThrow(/incomplete brief/u);
    expect(saved).toEqual(rows);

    const notes = [...Array.from({ length: 21 }, (_, i) => ({ startSec: i, endSec: i + 1, text: 'Agenda item. '.repeat(35) })), ...saved];
    let reductions = 0;
    const result = await generateRecordingNotes(rows, {
        countTokens,
        complete: async (prompt, limit) => {
            expect(await countTokens(prompt) + limit).toBeLessThanOrEqual(summaryContext);
            expect(bodyOf(prompt)).not.toContain('NEW LINES\n');
            reductions++;
            return bodyOf(prompt).includes('Friday') ? 'The report is due Friday.' : 'Agenda items.';
        },
    }, () => undefined, () => { throw new Error('Already saved'); }, notes);
    expect(reductions).toBeGreaterThan(2);
    expect(result.brief).toBe('The report is due Friday.');
    expect(result.detailed).toBe(notes.map((note) => note.text).join('\n\n'));
});

it('retries an overlong brief, checks the replacement and rejects a repeated long answer', async () => {
    const note = { startSec: 0, endSec: 8, text: 'Twelve boxes were estimated for the pilot shipment. After counting them the final shipment contains nine. The report will be delivered Friday. A second shipment was discussed and never scheduled.' };
    const replacement = 'The shipment contains nine boxes. The report is due Friday, and another shipment is unconfirmed.';
    const checked = 'The shipment contains nine boxes. The report is due Friday. Another shipment remains unscheduled.';
    const run = (answers: string[]) => generateRecordingNotes([note], {
        countTokens,
        complete: (prompt) => {
            if (bodyOf(prompt).includes(replacement)) {
                expect(bodyOf(prompt)).toContain(note.text);
                return Promise.resolve(checked);
            }
            return Promise.resolve(answers.shift() ?? note.text);
        },
    }, () => undefined, () => Promise.resolve(), [note]);
    await expect(run([note.text, note.text, replacement])).resolves.toEqual({ brief: checked, detailed: note.text });
    await expect(run([])).rejects.toThrow(/condense/u);
});

it('keeps a single short reviewed sentence verbatim, including its negation', async () => {
    const note = { startSec: 0, endSec: 5, text: 'Поставку не согласовали.' };
    const complete = vi.fn(() => Promise.resolve('Поставку согласовали.'));
    await expect(generateRecordingNotes([note], { countTokens, complete }, () => {}, () => Promise.resolve(), [note]))
        .resolves.toEqual({ brief: note.text, detailed: note.text });
    expect(complete).not.toHaveBeenCalled();
});

it('replaces short English answers and accepts a short source-language phrase on review', async () => {
    const speech = { startSec: 0, endSec: 2, text: 'Склад закрыт.' };
    const answers = ['Nine boxes.', speech.text, '«The warehouse is closed.»', speech.text];
    const complete = vi.fn(() => Promise.resolve(answers.shift() ?? null));
    await expect(generateRecordingNotes([speech], { countTokens, complete }, () => {}, () => Promise.resolve(), undefined, 'ru'))
        .resolves.toEqual({ detailed: speech.text, brief: speech.text });
    expect(answers).toHaveLength(0);
});

it('combines separately shortened paragraphs on a later pass', async () => {
    const text = 'The meeting discussed delivery dates and warehouse capacity. '.repeat(20);
    const notes = [0, 60].map((startSec) => ({ startSec, endSec: startSec + 60, text }));
    const brief = 'The meeting discussed delivery dates.';
    const complete = vi.fn(async (prompt: string, limit: number) => {
        expect(await countTokens(prompt) + limit).toBeLessThanOrEqual(summaryContext);
        return brief;
    });
    const result = await generateRecordingNotes([notes[0]], { countTokens, complete }, () => {},
        () => Promise.resolve(), notes, 'en', { prompt: 'Summarize. '.repeat(250), chunkCount: 0, overlapPercent: 10 });
    expect(result).toEqual({ brief, detailed: `${text}\n\n${text}` });
    expect(complete).toHaveBeenCalledTimes(6);
});

it('stops reducing separate paragraphs when their volume does not decrease', async () => {
    const text = 'Delivery'.repeat(70) + ' is pending.';
    const notes = [0, 60].map((startSec) => ({ startSec, endSec: startSec + 60, text }));
    const complete = vi.fn(() => Promise.resolve(text));
    await expect(generateRecordingNotes([{ ...notes[0], text: 'The delivery is pending.' }], { countTokens, complete }, () => {},
        () => Promise.resolve(), notes, 'en', { prompt: 'Summarize. '.repeat(300), chunkCount: 0, overlapPercent: 10 }))
        .rejects.toThrow('The model could not condense the notes');
    expect(complete).toHaveBeenCalledTimes(4);
});
