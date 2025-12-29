import fs from 'fs/promises';
import type { IpcMain, BrowserWindow } from 'electron';
import { dialog } from 'electron';
import { AudioPreprocessor, type ConvertAudioOptions } from '../services/AudioPreprocessor';

export function registerFileController(ipc: IpcMain, _getMainWindow: () => BrowserWindow | null): void {
    const audioProcessing = new AudioPreprocessor();

    ipc.handle('pickAudio', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'flac', 'ogg', 'opus', 'aac'] }],
            properties: ['openFile'],
        });

        if (canceled || filePaths.length === 0) return null;

        return filePaths[0];
    });

    ipc.handle('saveText', async (_event, content: string) => {
        try {
            const { canceled, filePath } = await dialog.showSaveDialog({
                title: 'Сохранить текстовую расшифровку',
                defaultPath: 'transcript.txt',
                filters: [{ name: 'Text', extensions: ['txt'] }],
            });

            if (canceled || !filePath) {
                return { ok: false, error: 'canceled' };
            }

            await fs.writeFile(filePath, content ?? '', 'utf8');

            return { ok: true as const, path: filePath };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);

            return { ok: false as const, error: message };
        }
    });

    ipc.handle(
        'convertAudio',
        async (_event, args: ConvertAudioOptions) => {
            const { path: wavPath } = await audioProcessing.convertAudio(args);

            return { path: wavPath };
        },
    );
}
