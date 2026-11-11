import { randomUUID } from 'crypto';
import type { RecordingSource, SessionDetails, SessionSourceRun, SessionTranscriptV1, SessionTranscriptionInfo } from '../types/sessions';
import type { SessionTranscribeOpts, TranscribeOpts } from '../types/transcription';
import { deriveSpeakerTranscript, materializeRecognitionTranscript, transcriptionResultToTranscript } from './sessionTranscript';
import { deriveSourceTranscript } from './transcriptDuplicateFilter';
import type { StructuredTranscriptionResult } from './whisperServer/utils';

interface SessionRepository {
    getSession(sessionId: string): Promise<SessionDetails>;
    saveTranscript(sessionId: string, transcript: SessionTranscriptV1, transcription?: SessionTranscriptionInfo): Promise<void>;
    prepareSourceAudio?(audioPath: string, mode: 'original' | 'optimized', signal?: AbortSignal, microphoneGate?: boolean): Promise<string>;
}

export interface SourcePass {
    source: RecordingSource;
    index: number;
    count: number;
    offsetSec: number;
}

export const mergeSourceTranscript = (run: SessionSourceRun, hideDuplicateSpeech = false): SessionTranscriptV1 => {
    return deriveSourceTranscript(run, hideDuplicateSpeech);
};

export async function transcribeSessionSources(
    sessionId: string,
    opts: SessionTranscribeOpts,
    repository: SessionRepository,
    transcribe: (audioPath: string, options: TranscribeOpts, pass: SourcePass) => Promise<string | StructuredTranscriptionResult>,
    signal: AbortSignal,
): Promise<SessionDetails> {
    if (!Number.isFinite(opts?.runId)) throw new Error('Invalid transcription request');
    const session = await repository.getSession(sessionId);
    const tracks = session.tracks;
    if (!tracks?.length) {
        signal.throwIfAborted();
        const mode = opts.optimized === false ? 'original' : 'optimized';
        const selected = await repository.prepareSourceAudio?.(session.audioOriginalPath, mode, signal) ?? session.audioOriginalPath;
        const result = await transcribe(selected, { ...opts, optimized: false }, { source: 'system', index: 0, count: 1, offsetSec: opts.segment?.start ?? 0 });
        signal.throwIfAborted();
        const transcript = transcriptionResultToTranscript(typeof result === 'string' ? { text: result } : result, opts.segment?.start ?? 0);
        await repository.saveTranscript(sessionId, transcript, { language: opts.language, model: opts.modelPath ? 'custom' : opts.model, segment: opts.segment });
        return repository.getSession(sessionId);
    }
    const previousRun = session.transcript?.sourceRun;
    if (opts.retryFailed && !previousRun) throw new Error('No incomplete transcription to retry');
    const {
        runId: _runId,
        sessionId: _sessionId,
        retryFailed: _retryFailed,
        hideDuplicateSpeech: _hideDuplicateSpeech,
        labelSpeakers: _labelSpeakers,
        speakerCount: _speakerCount,
        ...settings
    } = opts;
    const run: SessionSourceRun = opts.retryFailed && previousRun ? structuredClone(previousRun) : {
        status: 'incomplete', settings,
        sources: tracks.map((track) => ({ source: track.source, status: 'pending', segments: [] })),
    };
    const segment = run.settings.segment;
    if (typeof run.settings.language !== 'string' || (segment && (
        !Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.start < 0 || segment.end <= segment.start
    ))) throw new Error('Invalid transcription settings');
    const pendingSources = run.sources.filter((source) => source.status !== 'completed');
    const hasSystemTrack = tracks.some((track) => track.source === 'system');
    let recognitionRevision = opts.retryFailed && session.transcript ?
        materializeRecognitionTranscript(session.transcript).recognitionRevision : undefined;
    let recognizedSnapshot = JSON.stringify(opts.retryFailed && previousRun ?
        previousRun.sources.filter((source) => source.status === 'completed') : []);
    const save = async () => {
        run.status = run.sources.every((source) => source.status === 'completed') ? 'completed' : 'incomplete';
        const hasCompleted = run.sources.some((source) => source.status === 'completed');
        // Keep the previous recognition until the replacement has a completed source.
        if (!hasCompleted && session.transcript) return;
        const snapshot = JSON.stringify(run.sources.filter((source) => source.status === 'completed'));
        if (snapshot !== recognizedSnapshot) {
            recognitionRevision = randomUUID();
            recognizedSnapshot = snapshot;
        }
        const transcript = hasCompleted ? deriveSpeakerTranscript(materializeRecognitionTranscript({
            ...mergeSourceTranscript(run, opts.hideDuplicateSpeech ?? true),
            recognitionRevision,
            speakers: recognitionRevision === session.transcript?.recognitionRevision ?
                session.transcript?.speakers : undefined,
        })) : { ...(session.transcript ?? { version: 1 as const, segments: [] }), sourceRun: run };
        await repository.saveTranscript(sessionId, transcript);
    };
    signal.throwIfAborted();
    await save();
    for (const [index, source] of pendingSources.entries()) {
        signal.throwIfAborted();
        const track = tracks.find((candidate) => candidate.source === source.source);
        if (!track) throw new Error('Recording source is missing');
        const offsetSec = track.startOffsetMs / 1000;
        const start = Math.max(0, (segment?.start ?? 0) - offsetSec);
        const end = segment ? segment.end - offsetSec : undefined;
        const outsideTrack = (end !== undefined && end <= 0)
            || (track.durationMs !== undefined && start >= track.durationMs / 1000);
        try {
            const passOpts: TranscribeOpts = {
                ...run.settings, runId: opts.runId,
                segment: end !== undefined ? { start, end: Math.min(end, track.durationMs === undefined ? end : track.durationMs / 1000) } : undefined,
                microphoneGateEnabled: run.settings.optimized !== false && source.source === 'microphone' && hasSystemTrack
                    && run.settings.microphoneGateEnabled === true,
            };
            const result = outsideTrack ? { text: '', segments: [] } : await transcribe(await repository.prepareSourceAudio?.(track.filePath,
                run.settings.optimized === false ? 'original' : 'optimized', signal, passOpts.microphoneGateEnabled) ?? track.filePath,
                { ...passOpts, optimized: false, microphoneGateEnabled: repository.prepareSourceAudio ? false : passOpts.microphoneGateEnabled }, {
                source: source.source, index, count: pendingSources.length, offsetSec: offsetSec + start,
            });
            signal.throwIfAborted();
            const parsed = transcriptionResultToTranscript(typeof result === 'string' ? { text: result } : result,
                offsetSec + start);
            source.segments = parsed.recognitionSegments!.map((item) => ({
                ...item, id: `${source.source}:${item.id}`, source: source.source,
            }));
            source.status = 'completed';
            delete source.error;
        } catch (error) {
            if (signal.aborted) throw error;
            console.error('Source transcription failed', source.source, error);
            source.status = 'failed';
            source.error = 'Could not transcribe this source.';
            source.segments = [];
        }
        await save();
    }
    signal.throwIfAborted();
    if (session.transcript && !run.sources.some((source) => source.status === 'completed')) {
        throw new Error('Transcription failed for all recording sources. The previous transcript was kept.');
    }
    return repository.getSession(sessionId);
}
