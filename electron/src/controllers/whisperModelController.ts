import type { BrowserWindow, IpcMain } from 'electron';
import { WhisperModelService } from '../services/WhisperModelService';
import { isWhisperModelName } from '../types/whisper';

export function registerWhisperModelController(ipc: IpcMain, getMainWindow: () => BrowserWindow | null): void {
    const service = new WhisperModelService();

    ipc.handle('whisper-models:list', () => {
        return service.listModels();
    });

    ipc.handle('whisper-models:download', async (_event, modelName: unknown) => {
        if (!isWhisperModelName(modelName)) {
            throw new Error('Unknown model name');
        }

        return service.downloadModel(modelName, (progress) => {
            getMainWindow()?.webContents.send('whisper-models:download-progress', progress);
        });
    });
}
