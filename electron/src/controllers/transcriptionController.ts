import type { IpcMain, BrowserWindow } from 'electron';
import { SessionsService } from '../services/SessionsService';
import { TranscriptionService } from '../services/TranscriptionService';
import type { SessionTranscriptSegmentV1, SessionTranscriptV1 } from '../types/sessions';
import type { TranscribeOpts } from '../types/transcription';

const TRANSCRIPT_LINE_REGEX =
    /^\[(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]\s*(.*)$/;

const parseTimestampToSeconds = (match: RegExpMatchArray, offset: number): number => {
    const hours = Number(match[offset + 0]);
    const minutes = Number(match[offset + 1]);
    const seconds = Number(match[offset + 2]);
    const ms = Number(match[offset + 3]);

    if (
        !Number.isFinite(hours)
        || !Number.isFinite(minutes)
        || !Number.isFinite(seconds)
        || !Number.isFinite(ms)
    ) {
        return 0;
    }

    return hours * 3600 + minutes * 60 + seconds + ms / 1000;
};

const parseTranscriptToV1 = (text: string, offsetSec: number): SessionTranscriptV1 => {
    const segments: SessionTranscriptSegmentV1[] = [];
    const safeOffset = Number.isFinite(offsetSec) && offsetSec > 0 ? offsetSec : 0;

    for (const rawLine of text.split('\n')) {
        const line = rawLine.replace(/\r$/, '');

        const match = line.match(TRANSCRIPT_LINE_REGEX);

        if (!match) continue;

        const start = parseTimestampToSeconds(match, 1) + safeOffset;
        const end = parseTimestampToSeconds(match, 5) + safeOffset;
        const chunkText = (match[9] ?? '').trim();

        if (!chunkText) continue;

        segments.push({
            startSec: start,
            endSec: Number.isFinite(end) ? end : null,
            text: chunkText,
        });
    }

    if (segments.length === 0) {
        const fallback = text.trim();

        if (fallback) {
            segments.push({ startSec: safeOffset, endSec: null, text: fallback });
        }
    }

    return { version: 1, segments };
};

export function registerTranscriptionController(ipc: IpcMain, getMainWindow: () => BrowserWindow | null): void {
    const sessionsService = new SessionsService();
    const service = new TranscriptionService({
        onStdoutChunk: (chunk) => getMainWindow()?.webContents.send('transcribe:progress', chunk),
        onStderrChunk: (chunk) => getMainWindow()?.webContents.send('transcribe:log', chunk),
        onProgressPercent: (value) => getMainWindow()?.webContents.send('transcribe:progress-percent', value),
    });

    ipc.handle('transcribeStream', async (_event, audioPath: string, opts: TranscribeOpts) => {
        if (!audioPath || typeof audioPath !== 'string') {
            throw new Error('Invalid audioPath');
        }

        const transcriptText = await service.transcribe(audioPath, opts);

        const sessionId = opts?.sessionId;

        if (typeof sessionId === 'string' && sessionId.trim()) {
            const offsetSec = typeof opts.segment?.start === 'number' ? opts.segment.start : 0;
            const transcript = parseTranscriptToV1(transcriptText, offsetSec);
            const modelLabel = opts.modelPath ? 'custom' : opts.model;

            await sessionsService.saveTranscript(sessionId, transcript, {
                language: opts.language,
                model: modelLabel ? String(modelLabel) : undefined,
                segment: opts.segment ? { start: opts.segment.start, end: opts.segment.end } : undefined,
            }).catch((error: unknown) => {
                const message = error instanceof Error ? error.message : String(error);

                getMainWindow()?.webContents.send('transcribe:log', `Failed to save session transcript: ${message}`);
            });
        }

        return transcriptText;
    });

    ipc.handle('stop-transcription', () => {
        return service.stop();
    });
}
