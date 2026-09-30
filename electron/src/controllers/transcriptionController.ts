import type { IpcMain, BrowserWindow } from 'electron';
import { SessionsService } from '../services/SessionsService';
import { TranscriptionService } from '../services/TranscriptionService';
import { transcriptionResultToTranscript } from '../services/sessionTranscript';
import type { SessionTranscribeOpts, TranscribeOpts } from '../types/transcription';

export function registerTranscriptionController(
    ipc: IpcMain,
    getMainWindow: () => BrowserWindow | null,
    sessionsService = new SessionsService(),
    isSpeakerBusy: () => boolean = () => false,
): TranscriptionService {
    const service = new TranscriptionService({
        onStdoutChunk: (chunk) => getMainWindow()?.webContents.send('transcribe:progress', chunk),
        onStderrChunk: (chunk) => getMainWindow()?.webContents.send('transcribe:log', chunk),
        onProgressPercent: (value) => getMainWindow()?.webContents.send('transcribe:progress-percent', value),
    });

    ipc.handle('transcribeStream', async (_event, audioPath: string, opts: TranscribeOpts) => {
        if (isSpeakerBusy()) throw new Error('Another operation is in progress');
        if (!audioPath || typeof audioPath !== 'string') {
            throw new Error('Invalid audioPath');
        }

        const result = await service.transcribeResult(audioPath, opts);

        const sessionId = opts?.sessionId;

        if (typeof sessionId === 'string' && sessionId.trim()) {
            const offsetSec = typeof opts.segment?.start === 'number' ? opts.segment.start : 0;
            const transcript = transcriptionResultToTranscript(result, offsetSec);
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

        return result.text;
    });

    ipc.handle('transcribe:session', async (_event, sessionId: string, opts: SessionTranscribeOpts) => {
        if (isSpeakerBusy()) throw new Error('Another operation is in progress');
        return service.transcribeSession(sessionId, opts, sessionsService);
    });

    ipc.handle('stop-transcription', () => {
        return service.stopAndWait();
    });
    return service;
}
