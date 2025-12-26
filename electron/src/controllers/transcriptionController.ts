import type { IpcMain, BrowserWindow } from 'electron';
import { TranscriptionService } from '../services/TranscriptionService';

// TODO move types to suitable place
export type Segment = { start: number; end: number };
export interface TranscribeOpts {
    language: string;
    model?: 'large_v3_turbo' | 'small' | 'base' | 'base_q';
    maxContext?: number;
    maxLen?: number;
    splitOnWord?: boolean;
    useVad?: boolean;
    useGpu?: boolean;
    vadModelPath?: string;
    segment?: Segment;
}

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
