import { expect, it, vi } from 'vitest';
import type { SessionDetails, SessionTranscriptV1 } from '../types/sessions';
import type { SessionsService } from './SessionsService';
import { SessionSpeakerWorkflow } from './SessionSpeakerWorkflow';
import type { SpeakerAnalysisResult } from './SpeakerDiarizationService';

const microphoneTranscript: SessionTranscriptV1 = {
    version: 1,
    segments: [{ startSec: 0, endSec: 1, text: 'Hello', source: 'microphone' }],
    sourceRun: {
        status: 'completed', settings: { language: 'en' },
        sources: [{ source: 'microphone', status: 'completed', segments: [
            { startSec: 0, endSec: 1, text: 'Hello', source: 'microphone' },
        ] }],
    },
};

const sessionFor = (transcript: SessionTranscriptV1): SessionDetails => ({
    id: 'one', title: 'Test', createdAt: 0, updatedAt: 0, sourceKind: 'recorded',
    hasTranscript: true, audioOriginalPath: 'original.wav', audioWavPath: 'mix.wav',
    tracks: [{ source: 'microphone', filePath: 'mic.wav', startOffsetMs: 0 }], transcript,
});

it('labels a microphone-only transcript without loading assets or invoking sherpa', async () => {
    let session = sessionFor(microphoneTranscript);
    const sessions = {
        prepareSourceAudio: (audioPath: string) => Promise.resolve(audioPath),
        getSession: vi.fn(() => Promise.resolve(session)),
        getActiveSessionId: () => 'one',
        recognitionFingerprint: () => 'original',
        getActiveSessionGeneration: () => 0,
        replaceTranscriptIfCurrent: vi.fn((_id: string, fingerprint: string, replacement: SessionTranscriptV1) => {
            expect(fingerprint).toBe('original');
            session = sessionFor(replacement);
            return Promise.resolve(true);
        }),
    } as unknown as SessionsService;
    const runtime = {
        getAssetStatus: vi.fn(), prepareAssets: vi.fn(), analyze: vi.fn(),
    };
    const workflow = new SessionSpeakerWorkflow(sessions, runtime, vi.fn());

    const result = await workflow.analyze('one', {});

    expect(runtime.prepareAssets).not.toHaveBeenCalled();
    expect(runtime.analyze).not.toHaveBeenCalled();
    expect(result.transcript?.speakers?.speakers.map((speaker) => speaker.name)).toEqual(['Microphone speaker']);
    expect(result.transcript?.segments[0].speakerId).toBe(result.transcript?.speakers?.speakers[0].id);
});

it.each(['community', 'nemotron'] as const)('analyzes only the selected system range with %s and applies offsets once', async (engine) => {
    let session: SessionDetails = {
        ...sessionFor({ ...microphoneTranscript,
            sourceRun: {
                status: 'completed', settings: { language: 'en', segment: { start: 4, end: 8 } },
                sources: [
                    { source: 'microphone', status: 'completed', segments: [
                        { startSec: 4, endSec: 5, text: 'Local', source: 'microphone' },
                    ] },
                    { source: 'system', status: 'completed', segments: [
                        { startSec: 5, endSec: 6, text: 'Remote', source: 'system' },
                    ] },
                ],
            },
        }),
        tracks: [
            { source: 'microphone', filePath: 'mic.wav', startOffsetMs: 0 },
            { source: 'system', filePath: 'system.wav', startOffsetMs: 2000 },
        ],
    };
    const sessions = {
        prepareSourceAudio: (audioPath: string) => Promise.resolve(audioPath),
        getSession: vi.fn(() => Promise.resolve(session)),
        getActiveSessionId: () => 'one',
        getActiveSessionGeneration: () => 0,
        recognitionFingerprint: () => 'original',
        replaceTranscriptIfCurrent: vi.fn((_id: string, _fingerprint: string, replacement: SessionTranscriptV1) => {
            session = { ...session, transcript: replacement };
            return Promise.resolve(true);
        }),
    } as unknown as SessionsService;
    const runtime = {
        getAssetStatus: vi.fn(() => Promise.resolve({ engine: engine === 'nemotron' ? 'nemotron-3' as const : 'pyannote-community-1' as const,
            cpuReady: true, cudaReady: false, cudaAvailable: false })),
        prepareAssets: vi.fn(() => Promise.resolve()),
        analyze: vi.fn((_path: string, _options: { startSec: number; endSec?: number; speakerCount?: number }): Promise<SpeakerAnalysisResult> => Promise.resolve({
            intervals: [{ startSec: 1, endSec: 2, speakerId: 'speaker_0' }],
            fallbackUsed: false,
            ...(engine === 'nemotron' ? { engine: 'nemotron-3', backend: 'vulkan', device: 'vulkan:0', preset: 'v3-offline',
                modelRevision: 'model-revision', runtimeRevision: 'runtime-revision', modelSha256: 'model-hash', runtimeSha256: 'runtime-hash' } as const :
                { backend: 'cpu' } as const),
        })),
    };
    const workflow = new SessionSpeakerWorkflow(sessions, runtime, vi.fn());

    const result = await workflow.analyze('one', engine === 'community' ? { speakerCount: 2 } : {});

    expect(runtime.analyze).toHaveBeenCalledTimes(1);
    expect(runtime.analyze.mock.calls[0][0]).toBe('system.wav');
    expect(runtime.analyze.mock.calls[0][1]).toMatchObject({ startSec: 2, endSec: 6,
        speakerCount: engine === 'community' ? 2 : undefined });
    expect(result.transcript?.speakers?.intervals).toMatchObject([
        { startSec: 5, endSec: 6 },
    ]);
    expect(result.transcript?.speakers?.speakers.map((speaker) => speaker.name)).toEqual([
        'Microphone speaker', 'Speaker 1',
    ]);
    if (engine === 'nemotron') {
        expect(result.transcript?.speakers?.provenance).toMatchObject({ engine: 'nemotron-3', backend: 'vulkan',
            assignmentPolicy: 'conservative-overlap-v1', range: { start: 4, end: 8 },
            acousticIntervals: [{ startSec: 5, endSec: 6 }] });
        expect(result.transcript?.speakers?.provenance).not.toHaveProperty('exclusiveIntervals');
        expect(result.transcript?.speakers?.provenance).not.toHaveProperty('speakerCount');
    }
});

it('rejects unsupported exact counts before downloading or replacing saved speaker results', async () => {
    const session = { ...sessionFor({ version: 1, segments: [{ startSec: 0, endSec: 1, text: 'Hello' }] }),
        sourceKind: 'imported' as const, tracks: undefined };
    const replaceTranscriptIfCurrent = vi.fn();
    const sessions = { getSession: () => Promise.resolve(session), getActiveSessionId: () => 'one',
        getActiveSessionGeneration: () => 0, recognitionFingerprint: () => 'original', replaceTranscriptIfCurrent } as unknown as SessionsService;
    const runtime = { getAssetStatus: () => Promise.resolve({ engine: 'nemotron-3' as const,
        cpuReady: false, cudaReady: false, cudaAvailable: false }), prepareAssets: vi.fn(), analyze: vi.fn() };
    await expect(new SessionSpeakerWorkflow(sessions, runtime, vi.fn()).analyze('one', { speakerCount: 2 }))
        .rejects.toMatchObject({ code: 'SPEAKER_COUNT_UNSUPPORTED' });
    expect(runtime.prepareAssets).not.toHaveBeenCalled();
    expect(runtime.analyze).not.toHaveBeenCalled();
    expect(replaceTranscriptIfCurrent).not.toHaveBeenCalled();
});

it('analyzes an imported mono source even when it sounds like a microphone', async () => {
    let session: SessionDetails = {
        ...sessionFor({ version: 1, segments: [{ startSec: 0, endSec: 1, text: 'Hello' }] }),
        sourceKind: 'imported', tracks: undefined, audioWavPath: 'mono.wav',
    };
    const sessions = {
        prepareSourceAudio: (audioPath: string) => Promise.resolve(audioPath),
        getSession: vi.fn(() => Promise.resolve(session)),
        getActiveSessionId: () => 'one',
        getActiveSessionGeneration: () => 0,
        recognitionFingerprint: () => 'original',
        replaceTranscriptIfCurrent: vi.fn((_id: string, _fingerprint: string, replacement: SessionTranscriptV1) => {
            session = { ...session, transcript: replacement };
            return Promise.resolve(true);
        }),
    } as unknown as SessionsService;
    const runtime = {
        getAssetStatus: vi.fn(() => Promise.resolve({ cpuReady: true, cudaReady: false, cudaAvailable: false })),
        prepareAssets: vi.fn(() => Promise.resolve()),
        analyze: vi.fn((_path: string) => Promise.resolve({ intervals: [], backend: 'cpu' as const, fallbackUsed: false })),
    };

    await new SessionSpeakerWorkflow(sessions, runtime, vi.fn()).analyze('one', {});

    expect(runtime.analyze).toHaveBeenCalledTimes(1);
    // The listening WAV may already have dynamic normalization applied.
    expect(runtime.analyze.mock.calls[0][0]).toBe('original.wav');
    expect(session.transcript?.speakers?.speakers).toEqual([]);
});

it('preserves recognition when a completed system track has no audio file', async () => {
    const session = sessionFor({ ...microphoneTranscript, sourceRun: {
        status: 'completed', settings: { language: 'en' },
        sources: [{ source: 'system', status: 'completed', segments: [
            { startSec: 0, endSec: 1, text: 'Hello', source: 'system' },
        ] }],
    } });
    const replaceTranscriptIfCurrent = vi.fn();
    const sessions = {
        prepareSourceAudio: (audioPath: string) => Promise.resolve(audioPath),
        getSession: vi.fn(() => Promise.resolve(session)),
        getActiveSessionId: () => 'one',
        getActiveSessionGeneration: () => 0,
        recognitionFingerprint: () => 'original',
        replaceTranscriptIfCurrent,
    } as unknown as SessionsService;
    const runtime = { getAssetStatus: vi.fn(), prepareAssets: vi.fn(), analyze: vi.fn() };

    await expect(new SessionSpeakerWorkflow(sessions, runtime, vi.fn()).analyze('one', {}))
        .rejects.toThrow('audio is unavailable');
    expect(runtime.prepareAssets).not.toHaveBeenCalled();
    expect(replaceTranscriptIfCurrent).not.toHaveBeenCalled();
});

it('does not replace a prior visible transcript while a new source run has no completed results', async () => {
    const session = sessionFor({ ...microphoneTranscript, sourceRun: {
        status: 'incomplete', settings: { language: 'en' },
        sources: [{ source: 'microphone', status: 'pending', segments: [] }],
    } });
    const sessions = {
        prepareSourceAudio: (audioPath: string) => Promise.resolve(audioPath),
        getSession: vi.fn(() => Promise.resolve(session)),
        getActiveSessionId: () => 'one',
        getActiveSessionGeneration: () => 0,
    } as unknown as SessionsService;
    const runtime = { getAssetStatus: vi.fn(), prepareAssets: vi.fn(), analyze: vi.fn() };

    await expect(new SessionSpeakerWorkflow(sessions, runtime, vi.fn()).analyze('one', {}))
        .rejects.toThrow('no completed recognition');
    expect(runtime.analyze).not.toHaveBeenCalled();
    expect(session.transcript?.segments[0].text).toBe('Hello');
});

it('does not replace an existing result after cancellation', async () => {
    const prior = { ...microphoneTranscript, speakers: {
        version: 1 as const, recognitionRevision: 'old', generation: 'old',
        settings: {}, intervals: [], speakers: [{ id: 'old:microphone', name: 'Custom' }],
        corrections: [], status: 'completed' as const,
    } };
    const session = {
        ...sessionFor(prior), sourceKind: 'imported' as const,
        tracks: undefined, audioWavPath: 'import.wav',
        transcript: { ...prior, recognitionSegments: [{ id: 'raw', startSec: 0, endSec: 1, text: 'Hello' }] },
    };
    const replaceTranscriptIfCurrent = vi.fn();
    const sessions = {
        prepareSourceAudio: (audioPath: string) => Promise.resolve(audioPath),
        getSession: vi.fn(() => Promise.resolve(session)),
        getActiveSessionId: () => 'one',
        recognitionFingerprint: () => 'original',
        getActiveSessionGeneration: () => 0,
        replaceTranscriptIfCurrent,
    } as unknown as SessionsService;
    const runtime = {
        getAssetStatus: vi.fn(() => Promise.resolve({ cpuReady: true, cudaReady: false, cudaAvailable: false })),
        prepareAssets: vi.fn(() => Promise.resolve()),
        analyze: vi.fn(async (_path, _options, signal: AbortSignal) => {
            await new Promise<void>((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true });
            });
            throw new Error('Cancelled');
        }),
    };
    const workflow = new SessionSpeakerWorkflow(sessions, runtime, vi.fn());
    const pending = workflow.analyze('one', {});
    await vi.waitFor(() => expect(runtime.analyze).toHaveBeenCalled());
    const stopping = workflow.stopAndWait();
    await expect(pending).rejects.toThrow('Cancelled');
    await expect(stopping).resolves.toBe(true);
    expect(replaceTranscriptIfCurrent).not.toHaveBeenCalled();
    expect(session.transcript.speakers?.speakers[0].name).toBe('Custom');
});

it('does not report cancellation after speaker labels have been saved', async () => {
    let session = sessionFor(microphoneTranscript);
    let finishRead: (value: SessionDetails) => void = () => undefined;
    const getSession = vi.fn(() => getSession.mock.calls.length === 1 ? Promise.resolve(session) :
        new Promise<SessionDetails>((resolve) => { finishRead = resolve; }));
    const sessions = {
        getSession,
        getActiveSessionId: () => 'one',
        getActiveSessionGeneration: () => 0,
        recognitionFingerprint: () => 'original',
        replaceTranscriptIfCurrent: vi.fn((_id: string, _fingerprint: string, replacement: SessionTranscriptV1) => {
            session = sessionFor(replacement);
            return Promise.resolve(true);
        }),
    } as unknown as SessionsService;
    const runtime = { getAssetStatus: vi.fn(), prepareAssets: vi.fn(), analyze: vi.fn() };
    const workflow = new SessionSpeakerWorkflow(sessions, runtime, vi.fn());

    const pending = workflow.analyze('one', {});
    await vi.waitFor(() => expect(getSession).toHaveBeenCalledTimes(2));
    const stopping = workflow.stopAndWait();
    finishRead(session);

    await expect(stopping).resolves.toBe(false);
    await expect(pending).resolves.toMatchObject({ transcript: { speakers: { status: 'completed' } } });
});
