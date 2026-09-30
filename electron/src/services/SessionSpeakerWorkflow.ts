import { randomUUID } from 'crypto';
import type {
    SessionDetails,
    SessionRawSpan,
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
        onProgress?: (progress: { phase: 'converting' | 'analyzing' | 'fallback' }) => void,
    ): Promise<{ intervals: SessionSpeakerInterval[]; backend: 'cpu' | 'cuda'; fallbackUsed: boolean }>;
}

const validCount = (count: unknown): boolean => count === undefined
    || (typeof count === 'number' && Number.isSafeInteger(count) && count > 0);

export class SessionSpeakerWorkflow {
    private active: AbortController | null = null;
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

    private async runExclusive<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
        if (this.active) throw new Error('Another speaker operation is in progress');
        const controller = new AbortController();
        this.active = controller;
        let finish!: () => void;
        this.finished = new Promise<void>((resolve) => { finish = resolve; });
        try {
            return await work(controller.signal);
        } finally {
            this.active = null;
            finish();
        }
    }

    public async stopAndWait(): Promise<boolean> {
        if (!this.active) return false;
        this.active.abort();
        await this.finished;
        return true;
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
        return this.runExclusive(async (signal) => {
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
            const fingerprint = this.sessions.recognitionFingerprint(session.transcript);
            const transcript = materializeRecognitionTranscript(session.transcript);
            const generation = randomUUID();
            const range = session.sourceKind === 'recorded' ?
                transcript.sourceRun?.settings.segment :
                session.transcription?.segment;
            const settings = {
                ...(options.speakerCount === undefined ? {} : { speakerCount: options.speakerCount }),
                ...(range ? { range } : {}),
            };
            const intervals: SessionSpeakerInterval[] = [];
            const completedSystem = transcript.sourceRun?.sources.some((source) =>
                source.source === 'system' && source.status === 'completed' && source.segments.length > 0);
            const hasImportedText = session.sourceKind === 'imported'
                && (transcript.recognitionSegments ?? transcript.segments).length > 0;
            const systemTrack = session.tracks?.find((track) => track.source === 'system');
            const audioPath = session.sourceKind === 'imported' ? session.audioWavPath : systemTrack?.filePath;

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
                    const result = await this.runtime.analyze(audioPath, {
                        startSec, endSec, speakerCount: options.speakerCount,
                        preferCuda: assets.cudaReady && assets.cudaAvailable,
                    }, signal, (event) => this.progress({ sessionId, phase: event.phase }));
                    signal.throwIfAborted();
                    if (result.fallbackUsed) this.progress({ sessionId, phase: 'fallback' });
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
            const replacement = deriveSpeakerTranscript({ ...transcript, speakers });
            const saved = await this.sessions.replaceTranscriptIfCurrent(
                sessionId, fingerprint, replacement, signal, activeGeneration,
            );
            if (!saved) throw new Error('Recognition or active session changed during speaker analysis');
            return this.sessions.getSession(sessionId);
        });
    }

    private updateSpeakers(
        sessionId: string,
        change: (transcript: SessionTranscriptV1) => SessionTranscriptV1,
    ): Promise<SessionDetails> {
        return this.sessions.updateTranscript(sessionId, (current) => {
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

    public assign(sessionId: string, span: SessionRawSpan, speakerId: string | null): Promise<SessionDetails> {
        if (!span || typeof span.segmentId !== 'string' || !Number.isSafeInteger(span.startChar)
            || !Number.isSafeInteger(span.endChar) || span.startChar < 0 || span.endChar <= span.startChar) {
            throw new Error('Invalid transcript span');
        }
        return this.updateSpeakers(sessionId, (transcript) => {
            const metadata = transcript.speakers!;
            if (speakerId !== null && !metadata.speakers.some((item) => item.id === speakerId)) {
                throw new Error('Unknown speaker');
            }
            const raw = transcript.sourceRun?.sources.flatMap((source) => source.segments) ??
                transcript.recognitionSegments ?? [];
            const segment = raw.find((item) => item.id === span.segmentId);
            if (!segment || span.endChar > segment.text.length) throw new Error('Unknown transcript span');
            metadata.corrections = metadata.corrections.filter((item) =>
                item.segmentId !== span.segmentId || item.startChar !== span.startChar || item.endChar !== span.endChar);
            metadata.corrections.push({ ...span, speakerId });
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
