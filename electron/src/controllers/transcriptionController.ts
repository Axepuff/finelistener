import type { IpcMain, BrowserWindow } from 'electron';
import { createTranscriptionService } from '../services/transcription';

export interface TranscribeOpts {
    language: string;
    model?: 'large' | 'small';
    maxContext?: number;
    maxLen?: number;
    splitOnWord?: boolean;
    useVad?: boolean;
    vadModelPath?: string;
}

export function registerTranscriptionController(ipc: IpcMain, getMainWindow: () => BrowserWindow | null): void {
    const service = createTranscriptionService({
        onStdoutChunk: (chunk) => getMainWindow()?.webContents.send('transcribe:progress', chunk),
        onStderrChunk: (chunk) => getMainWindow()?.webContents.send('transcribe:log', chunk),
        onProgressPercent: (value) => getMainWindow()?.webContents.send('transcribe:progress-percent', value),
    });

    ipc.handle('transcribeStream', async (_event, audioPath: string, opts: TranscribeOpts) => {
        if (!audioPath || typeof audioPath !== 'string') {
            throw new Error('Invalid audioPath');
        }

        return service.transcribe(audioPath, opts);
    });

    ipc.handle('stop-transcription', () => {
        return service.stop();
    });
}
