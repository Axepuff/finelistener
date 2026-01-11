import type { IpcMain, BrowserWindow } from 'electron';
import { TranscriptionService } from '../services/TranscriptionService';
import type { TranscribeOpts } from '../types/transcription';

export function registerTranscriptionController(ipc: IpcMain, getMainWindow: () => BrowserWindow | null): void {
    const service = new TranscriptionService({
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
