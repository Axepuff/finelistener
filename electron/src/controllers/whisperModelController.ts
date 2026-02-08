import type { BrowserWindow, IpcMain } from 'electron';
import { dialog } from 'electron';
import { WhisperModelService } from '../services/WhisperModelService';
import { isWhisperModelName } from '../types/whisper';

export function registerWhisperModelController(ipc: IpcMain, getMainWindow: () => BrowserWindow | null): void {
    const service = new WhisperModelService();

    ipc.handle('whisper-models:list', () => {
        return service.listModels();
    });

    ipc.handle('whisper-models:import-from-file', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            title: 'Select a Whisper model file',
            filters: [{ name: 'Whisper models', extensions: ['bin', 'gguf'] }],
            properties: ['openFile'],
        });

        if (canceled || filePaths.length === 0) return null;

        try {
            const imported = await service.importModelFromFile(filePaths[0]);

            return { ok: true as const, ...imported };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            return { ok: false as const, error: message };
        }
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
