import { expect, it, vi } from 'vitest';
import type { SessionDetails, SessionTranscriptV1 } from '../types/sessions';
import { SessionsService } from './SessionsService';
import { transcribeSessionSources } from './SessionTranscriptionRunner';

const createRepository = () => {
    const session: SessionDetails = {
        id: 'session', title: 'Recording', createdAt: 0, updatedAt: 0,
        sourceKind: 'recorded', hasTranscript: false, audioOriginalPath: 'mix.wav', audioWavPath: 'mix.wav',
        tracks: [
            { source: 'system', filePath: 'system.wav', startOffsetMs: 0 },
            { source: 'microphone', filePath: 'microphone.wav', startOffsetMs: 500 },
        ],
    };
    return {
        session,
        getSession: vi.fn(() => Promise.resolve(structuredClone(session))),
        saveTranscript: vi.fn((_id: string, transcript: SessionTranscriptV1) => {
            session.transcript = structuredClone(transcript);
            return Promise.resolve();
        }),
    };
};

const createFilterService = (repository: ReturnType<typeof createRepository>): SessionsService => {
    const service = new SessionsService();
    vi.spyOn(service, 'updateTranscript').mockImplementation((_sessionId, update) => {
        const session = repository.session;
        session.transcript = update(structuredClone(session.transcript!));
        return Promise.resolve(structuredClone(session));
    });
    return service;
};

it('recognizes sources sequentially, preserves overlapping segments and applies the shared selected range', async () => {
    const repository = createRepository();
    const transcribe = vi.fn().mockResolvedValueOnce('[00:00:00.200 --> 00:00:01.000] System')
        .mockResolvedValueOnce('[00:00:00.100 --> 00:00:01.200] Microphone');
    const result = await transcribeSessionSources('session', {
        runId: 1, language: 'en', segment: { start: 3, end: 6 }, optimized: true,
        microphoneGateEnabled: true,
    }, repository, transcribe, new AbortController().signal);
    expect(transcribe.mock.calls[0][1]).toMatchObject({ segment: { start: 3, end: 6 }, optimized: true });
    expect(transcribe.mock.calls[0][1]).toMatchObject({ microphoneGateEnabled: false });
    expect(transcribe.mock.calls[1][1]).toMatchObject({ segment: { start: 2.5, end: 5.5 }, microphoneGateEnabled: true });
    expect(result.transcript?.segments).toMatchObject([
        { source: 'microphone', startSec: 3.1, endSec: 4.2, text: 'Microphone' },
        { source: 'system', startSec: 3.2, endSec: 4, text: 'System' },
    ]);
    expect(result.transcript?.sourceRun?.status).toBe('completed');
});

it('can disable the microphone gate for a dual-source run', async () => {
    const repository = createRepository();
    const transcribe = vi.fn().mockResolvedValue('');

    await transcribeSessionSources('session', {
        runId: 1, language: 'en', microphoneGateEnabled: false,
    }, repository, transcribe, new AbortController().signal);

    expect(transcribe.mock.calls[1][1]).toMatchObject({ microphoneGateEnabled: false });
    expect(repository.session.transcript?.sourceRun?.settings.microphoneGateEnabled).toBe(false);
});

it('saves structured final words with source and recording offsets', async () => {
    const repository = createRepository();
    repository.session.tracks = [repository.session.tracks![1]];
    const result = await transcribeSessionSources('session', { runId: 1, language: 'ru' }, repository,
        vi.fn().mockResolvedValue({ text: '[00:00:00.000 --> 00:00:01.000] draft', segments: [{
            startSec: 0, endSec: 1, text: ' Привет', words: [{
                startSec: 0.1, endSec: 0.7, text: 'Привет', startChar: 1, endChar: 7,
            }],
        }] }), new AbortController().signal);
    const raw = result.transcript?.sourceRun?.sources[0].segments[0];
    expect(raw).toMatchObject({ source: 'microphone', startSec: 0.5, endSec: 1.5,
        text: ' Привет', words: [{ startSec: 0.6, endSec: 1.2, text: 'Привет' }] });
    expect(raw?.id).toBeTruthy();
    expect(result.transcript?.recognitionRevision).toBeTruthy();
});

it('replaces speaker metadata when a new recognition has the same words', async () => {
    const repository = createRepository();
    repository.session.tracks = [repository.session.tracks![1]];
    repository.session.transcript = {
        version: 1, recognitionRevision: 'previous-run',
        segments: [{ startSec: 0.5, endSec: null, text: 'Hello', source: 'microphone' }],
        speakers: {
            version: 1, recognitionRevision: 'previous-run', generation: 'old',
            settings: {}, intervals: [], speakers: [{ id: 'old:microphone', name: 'Alice' }],
            corrections: [], status: 'completed',
        },
    };

    const result = await transcribeSessionSources('session', { runId: 2, language: 'en' }, repository,
        vi.fn().mockResolvedValue('Hello'), new AbortController().signal);

    expect(result.transcript?.recognitionRevision).toBeTruthy();
    expect(result.transcript?.recognitionRevision).not.toBe('previous-run');
    expect(result.transcript?.speakers).toBeUndefined();
});

it('does not gate a microphone-only recording', async () => {
    const repository = createRepository();
    repository.session.tracks = repository.session.tracks?.filter((track) => track.source === 'microphone');
    const transcribe = vi.fn().mockResolvedValue('');

    await transcribeSessionSources('session', {
        runId: 1, language: 'en', microphoneGateEnabled: true,
    }, repository, transcribe, new AbortController().signal);

    expect(transcribe.mock.calls[0][1]).toMatchObject({ microphoneGateEnabled: false });
});

it('persists successful work before the next pass and retries only unfinished sources using the saved settings', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const repository = createRepository();
    const transcribe = vi.fn().mockResolvedValueOnce('')
        .mockImplementationOnce(() => {
            expect(repository.session.transcript?.sourceRun?.sources[0].status).toBe('completed');
            throw new Error('Unavailable');
        });
    await transcribeSessionSources('session', {
        runId: 1, language: 'en', modelPath: 'original-model', optimized: true, segment: { start: 2, end: 5 },
    }, repository, transcribe, new AbortController().signal);
    expect(repository.session.transcript?.sourceRun?.status).toBe('incomplete');
    const retry = vi.fn().mockResolvedValue('Recovered');
    const result = await transcribeSessionSources('session', {
        runId: 2, language: 'fr', retryFailed: true, optimized: false,
    }, repository, retry, new AbortController().signal);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry.mock.calls[0][0]).toBe('microphone.wav');
    expect(retry.mock.calls[0][1]).toMatchObject({
        runId: 2, language: 'en', modelPath: 'original-model', optimized: true, segment: { start: 1.5, end: 4.5 },
    });
    expect(result.transcript?.sourceRun?.status).toBe('completed');
    expect(result.transcript?.segments).toHaveLength(1);
});

it('keeps completed sources after cancellation and does not publish unfinished output', async () => {
    const repository = createRepository();
    const operation = new AbortController();
    const transcribe = vi.fn().mockResolvedValueOnce('Saved').mockImplementationOnce(() => {
        operation.abort();
        return Promise.resolve('Unfinished');
    });
    await expect(transcribeSessionSources('session', { runId: 1, language: 'en' }, repository,
        transcribe, operation.signal)).rejects.toThrow();
    expect(repository.session.transcript?.segments.map((item) => item.text)).toEqual(['Saved']);
    expect(repository.session.transcript?.sourceRun?.sources[1].status).toBe('pending');
});

it('preserves the previous transcript when cancelled before any source completes', async () => {
    const repository = createRepository();
    repository.session.transcript = { version: 1, segments: [{ startSec: 0, endSec: null, text: 'Previous' }] };
    const operation = new AbortController();
    const transcribe = vi.fn().mockImplementation(() => {
        operation.abort();
        return Promise.resolve('Unfinished');
    });
    await expect(transcribeSessionSources('session', { runId: 1, language: 'en' }, repository,
        transcribe, operation.signal)).rejects.toThrow();
    expect(repository.session.transcript?.segments[0].text).toBe('Previous');
});

it('keeps the complete previous recognition when a replacement is cancelled before its first result', async () => {
    const repository = createRepository();
    const original: SessionTranscriptV1 = {
        version: 1,
        recognitionRevision: 'original-revision',
        segments: [{ startSec: 0, endSec: 1, text: 'Original words', source: 'system' }],
        sourceRun: {
            status: 'completed', settings: { language: 'en' },
            sources: [
                { source: 'system', status: 'completed', segments: [
                    { id: 'system:old', startSec: 0, endSec: 1, text: 'Original words', source: 'system' },
                ] },
                { source: 'microphone', status: 'completed', segments: [] },
            ],
        },
        speakers: {
            version: 1, recognitionRevision: 'original-revision', generation: 'old',
            settings: {}, intervals: [], speakers: [{ id: 'old:system', name: 'Alice' }],
            corrections: [], status: 'completed',
        },
    };
    repository.session.transcript = structuredClone(original);
    const operation = new AbortController();
    const transcribe = vi.fn().mockImplementation(() => {
        operation.abort();
        return Promise.resolve('Unfinished words');
    });

    await expect(transcribeSessionSources('session', { runId: 2, language: 'en' }, repository,
        transcribe, operation.signal)).rejects.toThrow();

    expect(repository.session.transcript).toEqual(original);
    const service = createFilterService(repository);
    const filtered = await service.setTranscriptDuplicateFilter('session', false);
    expect(filtered.transcript?.segments.map((segment) => segment.text)).toEqual(['Original words']);
});

it('treats a range outside a disconnected source as a completed empty result', async () => {
    const repository = createRepository();
    repository.session.tracks![0].durationMs = 1000;
    const transcribe = vi.fn().mockResolvedValue('Remaining audio');
    const result = await transcribeSessionSources('session', {
        runId: 1, language: 'en', segment: { start: 5, end: 6 },
    }, repository, transcribe, new AbortController().signal);
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(result.transcript?.sourceRun?.sources[0]).toMatchObject({ status: 'completed', segments: [] });
});

it('filters completed cross-source duplicates without changing the original recognition results', async () => {
    const repository = createRepository();
    const duplicated = 'This nearby system phrase contains enough words to filter';
    const transcribe = vi.fn()
        .mockResolvedValueOnce(`[00:00:01.000 --> 00:00:03.000] ${duplicated}`)
        .mockResolvedValueOnce(`[00:00:00.600 --> 00:00:03.000] ${duplicated}, local response.`);

    const result = await transcribeSessionSources('session', {
        runId: 1,
        language: 'en',
        hideDuplicateSpeech: true,
    }, repository, transcribe, new AbortController().signal);

    expect(result.transcript?.segments.map((item) => [item.source, item.text])).toEqual([
        ['system', duplicated],
        ['microphone', 'local response.'],
    ]);
    expect(result.transcript?.sourceRun?.sources[1].segments[0].text).toBe(`${duplicated}, local response.`);
    expect(result.transcript?.sourceRun?.settings).not.toHaveProperty('hideDuplicateSpeech');
});

it('recomputes filtering from the same run after a failed source is retried', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const repository = createRepository();
    const duplicated = 'This recovered phrase contains enough words for filtering';
    const initial = vi.fn().mockResolvedValueOnce(duplicated).mockRejectedValueOnce(new Error('Unavailable'));

    await transcribeSessionSources('session', {
        runId: 1,
        language: 'en',
        hideDuplicateSpeech: true,
    }, repository, initial, new AbortController().signal);
    expect(repository.session.transcript?.segments.map((item) => item.text)).toEqual([duplicated]);

    const retry = vi.fn().mockResolvedValue(duplicated);
    const result = await transcribeSessionSources('session', {
        runId: 2,
        language: 'fr',
        retryFailed: true,
        hideDuplicateSpeech: true,
    }, repository, retry, new AbortController().signal);

    expect(result.transcript?.segments.map((item) => [item.source, item.text])).toEqual([
        ['system', duplicated],
    ]);
    expect(result.transcript?.sourceRun?.sources[1]).toMatchObject({ status: 'completed' });
});

it.each([false, true])(
    'keeps the previous visible transcript when duplicate filtering is set to %s after all new sources fail',
    async (enabled) => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const repository = createRepository();
        const previousSegments = [{ startSec: 0, endSec: null, text: 'Previously saved important words' }];
        repository.session.transcript = { version: 1, segments: previousSegments };
        const transcribe = vi.fn().mockRejectedValue(new Error('Unavailable'));

        await expect(transcribeSessionSources('session', {
            runId: 1,
            language: 'en',
        }, repository, transcribe, new AbortController().signal)).rejects.toThrow(
            'Transcription failed for all recording sources. The previous transcript was kept.',
        );
        expect(repository.session.transcript?.segments).toEqual(previousSegments);

        const service = createFilterService(repository);
        await expect(service.setTranscriptDuplicateFilter('session', enabled)).rejects.toThrow(
            'Session has no source-aware transcript',
        );

        expect(repository.session.transcript?.segments).toEqual(previousSegments);
        expect(repository.session.transcript?.sourceRun).toBeUndefined();
    },
);

it('keeps the previous visible transcript when filtering changes after cancellation before any source completes', async () => {
    const repository = createRepository();
    const previousSegments = [{ startSec: 0, endSec: null, text: 'Previously saved important words' }];
    repository.session.transcript = { version: 1, segments: previousSegments };
    const operation = new AbortController();
    const transcribe = vi.fn().mockImplementation(() => {
        operation.abort();

        return Promise.resolve('Unpublished text');
    });

    await expect(transcribeSessionSources('session', {
        runId: 1,
        language: 'en',
    }, repository, transcribe, operation.signal)).rejects.toThrow();
    const service = createFilterService(repository);
    await expect(service.setTranscriptDuplicateFilter('session', false)).rejects.toThrow(
        'Session has no source-aware transcript',
    );

    expect(repository.session.transcript?.segments).toEqual(previousSegments);
    expect(repository.session.transcript?.sourceRun).toBeUndefined();
});

it.each([false, true])(
    'allows duplicate filtering to be set to %s after sources complete with no recognized speech',
    async (enabled) => {
        const repository = createRepository();
        repository.session.transcript = {
            version: 1,
            segments: [{ startSec: 0, endSec: null, text: 'Previous text' }],
        };

        await transcribeSessionSources('session', {
            runId: 1,
            language: 'en',
        }, repository, vi.fn().mockResolvedValue(''), new AbortController().signal);
        expect(repository.session.transcript?.segments).toEqual([]);

        const service = createFilterService(repository);
        await expect(service.setTranscriptDuplicateFilter('session', enabled)).resolves.toMatchObject({
            transcript: { segments: [] },
        });
        expect(repository.session.transcript?.sourceRun?.sources.every(
            (source) => source.status === 'completed',
        )).toBe(true);
    },
);
