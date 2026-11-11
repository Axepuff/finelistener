import { randomUUID } from 'crypto';
import type {
    SessionDetails,
    SessionRawSpan,
    SessionSpeakerAssignment,
    SessionSpeakerProvenance,
    SessionSpeakerInterval,
    SessionTranscriptV1,
} from '../types/sessions';
import type { AnalyzeSpeakersOptions, SpeakerAnalysisProgressEvent, SpeakerAssetStatus } from '../types/transcription';
import type { SessionsService } from './SessionsService';
import {
    createSpeakerMetadata,
    deriveSpeakerTranscript,
    materializeRecognitionTranscript,
} from './sessionTranscript';

interface SpeakerRuntime {
    getAssetStatus(): Promise<SpeakerAssetStatus>;
    prepareAssets(
        preferCuda: boolean,
        signal: AbortSignal,
        onProgress?: (progress: { downloadedBytes: number; totalBytes?: number }) => void,
    ): Promise<void>;
    analyze(
        audioPath: string,
        options: { startSec: number; endSec?: number; speakerCount?: number; preferCuda?: boolean },
        signal: AbortSignal,
        onProgress?: (progress: { phase: 'converting' | 'analyzing' | 'fallback'; percent?: number }) => void,
    ): Promise<{ intervals: SessionSpeakerInterval[]; regularIntervals?: SessionSpeakerInterval[]; modelRevision?: string; runtimeRevision?: string; backend: 'cpu' | 'cuda'; fallbackUsed: boolean }>;
}

const validCount = (count: unknown): boolean => count === undefined
    || (typeof count === 'number' && Number.isSafeInteger(count) && count > 0);

interface SpeakerOperation {
    controller: AbortController;
    committed: boolean;
}

export class SessionSpeakerWorkflow {
    private active: SpeakerOperation | null = null;
    private finished: Promise<void> = Promise.resolve();

    constructor(
        private readonly sessions: SessionsService,
        private readonly runtime: SpeakerRuntime,
        private readonly progress: (event: SpeakerAnalysisProgressEvent) => void,
    ) {}

    public get isBusy(): boolean {
        return this.active !== null;
    }

    public getAssetStatus(): Promise<SpeakerAssetStatus> {
        return this.runtime.getAssetStatus();
    }

    private async runExclusive<T>(work: (signal: AbortSignal, markCommitted: () => void) => Promise<T>): Promise<T> {
        if (this.active) throw new Error('Another speaker operation is in progress');
        const operation = { controller: new AbortController(), committed: false };
        this.active = operation;
        let finish!: () => void;
        this.finished = new Promise<void>((resolve) => { finish = resolve; });
        try {
            return await work(operation.controller.signal, () => { operation.committed = true; });
        } finally {
            this.active = null;
            finish();
        }
    }

    public async stopAndWait(): Promise<boolean> {
        const operation = this.active;
        if (!operation) return false;
        const finished = this.finished;
        if (!operation.committed) operation.controller.abort();
        await finished;
        return !operation.committed;
    }

    public async prepareAssets(includeCuda: boolean): Promise<SpeakerAssetStatus> {
        return this.runExclusive(async (signal) => {
            const sessionId = this.sessions.getActiveSessionId() ?? '';
            this.progress({ sessionId, phase: 'preparing' });
            await this.runtime.prepareAssets(includeCuda, signal, (bytes) => {
                this.progress({ sessionId, phase: 'downloading', ...bytes });
            });
            signal.throwIfAborted();
            return this.runtime.getAssetStatus();
        });
    }

    public async analyze(sessionId: string, options: AnalyzeSpeakersOptions): Promise<SessionDetails> {
        if (!validCount(options?.speakerCount)) throw new Error('Invalid speaker count');
        return this.runExclusive(async (signal, markCommitted) => {
            const activeSessionId = this.sessions.getActiveSessionId();
            if (activeSessionId !== null && activeSessionId !== sessionId) {
                throw new Error('Session is no longer active');
            }
            const activeGeneration = this.sessions.getActiveSessionGeneration();
            const session = await this.sessions.getSession(sessionId);
            if (!session.transcript) throw new Error('Session has no transcript');
            if (session.transcript.sourceRun
                && !session.transcript.sourceRun.sources.some((source) => source.status === 'completed')) {
                throw new Error('Session has no completed recognition');
            }
            if (options.recognitionRevision !== undefined && options.recognitionRevision !== session.transcript.recognitionRevision) throw new Error('Recognition changed before speaker analysis');
            const audioMode = options.audioMode ?? session.audioMode ?? 'optimized';
            if (audioMode !== 'original' && audioMode !== 'optimized') throw new Error('Invalid audio mode');
            const fingerprint = this.sessions.recognitionFingerprint(session.transcript);
            const transcript = materializeRecognitionTranscript(session.transcript);
            const generation = randomUUID();
            const range = options.range ?? (session.sourceKind === 'recorded' ?
                transcript.sourceRun?.settings.segment :
                session.transcription?.segment);
            if (range && (!Number.isFinite(range.start) || range.start < 0 || !Number.isFinite(range.end) || range.end <= range.start)) throw new Error('Invalid speaker range');
            const settings = {
                ...(options.speakerCount === undefined ? {} : { speakerCount: options.speakerCount }),
                ...(range ? { range } : {}),
            };
            const intervals: SessionSpeakerInterval[] = [];
            let provenance: SessionSpeakerProvenance | undefined;
            const completedSystem = transcript.sourceRun?.sources.some((source) =>
                source.source === 'system' && source.status === 'completed' && source.segments.length > 0);
            const hasImportedText = session.sourceKind === 'imported'
                && (transcript.recognitionSegments ?? transcript.segments).length > 0;
            const systemTrack = session.tracks?.find((track) => track.source === 'system');
            const audioPath = session.sourceKind === 'imported' ? session.audioOriginalPath : systemTrack?.filePath;

            if ((completedSystem || hasImportedText) && !audioPath) {
                throw new Error('Speaker analysis audio is unavailable');
            }

            if ((completedSystem || hasImportedText) && audioPath) {
                const offsetSec = session.sourceKind === 'imported' ? 0 : (systemTrack?.startOffsetMs ?? 0) / 1000;
                const startSec = Math.max(0, (range?.start ?? offsetSec) - offsetSec);
                const trackEnd = session.sourceKind === 'recorded' && systemTrack?.durationMs !== undefined ?
                    systemTrack.durationMs / 1000 : undefined;
                const rangeEnd = range ? range.end - offsetSec : undefined;
                const endSec = rangeEnd === undefined ? trackEnd :
                    trackEnd === undefined ? rangeEnd : Math.min(rangeEnd, trackEnd);
                if (endSec === undefined || endSec > startSec) {
                    this.progress({ sessionId, phase: 'preparing' });
                    await this.runtime.prepareAssets(false, signal, (bytes) => {
                        this.progress({ sessionId, phase: 'downloading', ...bytes });
                    });
                    signal.throwIfAborted();
                    const assets = await this.runtime.getAssetStatus();
                    const selectedAudio = await this.sessions.prepareSourceAudio(audioPath, audioMode, signal);
                    const result = await this.runtime.analyze(selectedAudio, {
                        startSec, endSec, speakerCount: options.speakerCount,
                        preferCuda: assets.cudaReady && assets.cudaAvailable,
                    }, signal, (event) => this.progress({ sessionId, ...event }));
                    signal.throwIfAborted();
                    if (result.fallbackUsed) this.progress({ sessionId, phase: 'fallback' });
                    const mapIntervals = (items: SessionSpeakerInterval[]) => items.map((interval) => ({
                        startSec: offsetSec + startSec + interval.startSec,
                        endSec: offsetSec + startSec + interval.endSec,
                        speakerId: generation + ':' + interval.speakerId,
                    }));
                    if (result.modelRevision && result.runtimeRevision) provenance = {
                        version: 1, engine: 'pyannote-community-1', modelRevision: result.modelRevision,
                        runtimeRevision: result.runtimeRevision, audioMode, backend: result.backend, ...settings,
                        regularIntervals: mapIntervals(result.regularIntervals ?? []), exclusiveIntervals: mapIntervals(result.intervals),
                    };
                    for (const interval of result.intervals) {
                        if (!Number.isFinite(interval.startSec) || !Number.isFinite(interval.endSec)
                            || interval.endSec <= interval.startSec) continue;
                        intervals.push({
                            startSec: offsetSec + startSec + interval.startSec,
                            endSec: offsetSec + startSec + interval.endSec,
                            speakerId: `${generation}:${interval.speakerId}`,
                        });
                    }
                }
            }

            signal.throwIfAborted();
            this.progress({ sessionId, phase: 'saving' });
            const speakers = createSpeakerMetadata(transcript, intervals, settings, generation);
            if (provenance) speakers.provenance = provenance;
            const replacement = deriveSpeakerTranscript({ ...transcript, speakers });
            const saved = await this.sessions.replaceTranscriptIfCurrent(
                sessionId, fingerprint, replacement, signal, activeGeneration,
            );
            if (!saved) throw new Error('Recognition or active session changed during speaker analysis');
            markCommitted();
            return this.sessions.getSession(sessionId);
        });
    }

    private updateSpeakers(
        sessionId: string,
        change: (transcript: SessionTranscriptV1) => SessionTranscriptV1,
    ): Promise<SessionDetails> {
        const activeGeneration = this.sessions.getActiveSessionGeneration();
        if (this.sessions.getActiveSessionId() !== null && this.sessions.getActiveSessionId() !== sessionId) throw new Error('Session is no longer active');
        return this.sessions.updateTranscript(sessionId, (current) => {
            if (this.sessions.getActiveSessionGeneration() !== activeGeneration) throw new Error('Session changed before speaker edit');
            if (!current.speakers) throw new Error('Session has no speaker labels');
            if (current.speakers.recognitionRevision !== current.recognitionRevision) {
                throw new Error('Speaker labels belong to an older recognition');
            }
            return deriveSpeakerTranscript(change(structuredClone(current)));
        });
    }

    public rename(sessionId: string, speakerId: string, name: string): Promise<SessionDetails> {
        const trimmed = name?.trim();
        if (!trimmed || trimmed.length > 100) throw new Error('Invalid speaker name');
        return this.updateSpeakers(sessionId, (transcript) => {
            const speaker = transcript.speakers!.speakers.find((item) => item.id === speakerId);
            if (!speaker) throw new Error('Unknown speaker');
            speaker.name = trimmed;
            return transcript;
        });
    }

    public assign(sessionId: string, request: SessionRawSpan | SessionSpeakerAssignment, speakerId: string | null): Promise<SessionDetails> {
        const spans = request && 'spans' in request ? request.spans : [request];
        if (!Array.isArray(spans) || spans.length === 0 || spans.length > 10000 || spans.some((span) =>
            !span || typeof span.segmentId !== 'string' || !Number.isSafeInteger(span.startChar)
            || !Number.isSafeInteger(span.endChar) || span.startChar < 0 || span.endChar <= span.startChar)) {
            throw new Error('Invalid transcript spans');
        }
        return this.updateSpeakers(sessionId, (transcript) => {
            const metadata = transcript.speakers!;
            if ('spans' in request && (request.recognitionRevision !== transcript.recognitionRevision
                || request.generation !== metadata.generation)) throw new Error('Stale speaker assignment');
            if (speakerId !== null && !metadata.speakers.some((item) => item.id === speakerId)) throw new Error('Unknown speaker');
            const raw = transcript.sourceRun?.sources.flatMap((source) => source.segments) ?? transcript.recognitionSegments ?? [];
            // Validate every member before changing any corrections; persistence is one transaction.
            for (const span of spans) {
                const segment = raw.find((item) => item.id === span.segmentId);
                if (!segment || span.endChar > segment.text.length) throw new Error('Unknown transcript span');
            }
            for (const span of spans) {
                metadata.corrections = metadata.corrections.filter((item) =>
                    item.segmentId !== span.segmentId || item.startChar !== span.startChar || item.endChar !== span.endChar);
                metadata.corrections.push({ ...span, speakerId });
            }
            return transcript;
        });
    }

    public merge(sessionId: string, sourceId: string, targetId: string): Promise<SessionDetails> {
        if (sourceId === targetId) throw new Error('Choose two different speakers');
        return this.updateSpeakers(sessionId, (transcript) => {
            const metadata = transcript.speakers!;
            if (!metadata.speakers.some((item) => item.id === sourceId)
                || !metadata.speakers.some((item) => item.id === targetId)) throw new Error('Unknown speaker');
            metadata.speakers = metadata.speakers.filter((item) => item.id !== sourceId);
            metadata.merges = [...(metadata.merges ?? []).map((item) => ({
                ...item, toId: item.toId === sourceId ? targetId : item.toId,
            })), { fromId: sourceId, toId: targetId }];
            metadata.corrections = metadata.corrections.map((item) => ({
                ...item, speakerId: item.speakerId === sourceId ? targetId : item.speakerId,
            }));
            return transcript;
        });
    }
}
