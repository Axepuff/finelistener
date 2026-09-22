import type { RecordingSource, SessionDetails, SessionSourceRun, SessionTranscriptV1 } from '../types/sessions';
import type { SessionTranscribeOpts, TranscribeOpts } from '../types/transcription';
import { parseTranscriptToV1 } from './sessionTranscript';
import { deriveSourceTranscript } from './transcriptDuplicateFilter';

interface SessionRepository {
    getSession(sessionId: string): Promise<SessionDetails>;
    saveTranscript(sessionId: string, transcript: SessionTranscriptV1): Promise<void>;
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
    transcribe: (audioPath: string, options: TranscribeOpts, pass: SourcePass) => Promise<string>,
    signal: AbortSignal,
): Promise<SessionDetails> {
    if (!Number.isFinite(opts?.runId)) throw new Error('Invalid transcription request');
    const session = await repository.getSession(sessionId);
    const tracks = session.tracks;
    if (!tracks?.length) throw new Error('Session has no recording sources');
    const previousRun = session.transcript?.sourceRun;
    if (opts.retryFailed && !previousRun) throw new Error('No incomplete transcription to retry');
    const {
        runId: _runId,
        sessionId: _sessionId,
        retryFailed: _retryFailed,
        hideDuplicateSpeech: _hideDuplicateSpeech,
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
    const save = async () => {
        run.status = run.sources.every((source) => source.status === 'completed') ? 'completed' : 'incomplete';
        const transcript = mergeSourceTranscript(run, opts.hideDuplicateSpeech ?? true);
        if (!run.sources.some((source) => source.status === 'completed')) {
            transcript.segments = session.transcript?.segments ?? [];
        }
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
                segment: end !== undefined ? { start, end } : undefined,
            };
            const text = outsideTrack ? '' : await transcribe(track.filePath, passOpts, {
                source: source.source, index, count: pendingSources.length, offsetSec: offsetSec + start,
            });
            signal.throwIfAborted();
            source.segments = parseTranscriptToV1(text, offsetSec + start).segments.map((item) => ({
                ...item, source: source.source,
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
    return repository.getSession(sessionId);
}
