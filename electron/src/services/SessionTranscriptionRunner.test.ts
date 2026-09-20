import { expect, it, vi } from 'vitest';
import type { SessionDetails, SessionTranscriptV1 } from '../types/sessions';
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

it('recognizes sources sequentially, preserves overlapping segments and applies the shared selected range', async () => {
    const repository = createRepository();
    const transcribe = vi.fn().mockResolvedValueOnce('[00:00:00.200 --> 00:00:01.000] System')
        .mockResolvedValueOnce('[00:00:00.100 --> 00:00:01.200] Microphone');
    const result = await transcribeSessionSources('session', {
        runId: 1, language: 'en', segment: { start: 3, end: 6 }, optimized: true,
    }, repository, transcribe, new AbortController().signal);
    expect(transcribe.mock.calls[0][1]).toMatchObject({ segment: { start: 3, end: 6 }, optimized: true });
    expect(transcribe.mock.calls[1][1]).toMatchObject({ segment: { start: 2.5, end: 5.5 } });
    expect(result.transcript?.segments).toEqual([
        { source: 'microphone', startSec: 3.1, endSec: 4.2, text: 'Microphone' },
        { source: 'system', startSec: 3.2, endSec: 4, text: 'System' },
    ]);
    expect(result.transcript?.sourceRun?.status).toBe('completed');
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
