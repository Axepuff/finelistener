import type { BrowserWindow, IpcMain } from 'electron';
import { dialog } from 'electron';
import { SessionsService } from '../services/SessionsService';

export function registerSessionsController(ipc: IpcMain, _getMainWindow: () => BrowserWindow | null): void {
    const service = new SessionsService();

    ipc.handle('sessions:list', async () => {
        return service.listSessions();
    });

    ipc.handle('sessions:get', async (_event, sessionId: unknown) => {
        if (typeof sessionId !== 'string' || !sessionId.trim()) {
            throw new Error('Invalid session id');
        }

        return service.getSession(sessionId);
    });

    ipc.handle('sessions:delete', async (_event, sessionId: unknown) => {
        if (typeof sessionId !== 'string' || !sessionId.trim()) {
            throw new Error('Invalid session id');
        }

        await service.deleteSession(sessionId);

        return true;
    });

    ipc.handle('sessions:import-audio', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'flac', 'ogg', 'opus', 'aac'] }],
            properties: ['openFile'],
        });

        if (canceled || filePaths.length === 0) return null;

        return service.createSessionFromImport(filePaths[0]);
    });

    ipc.handle('sessions:import-recording', async (_event, recordingFilePath: unknown) => {
        if (typeof recordingFilePath !== 'string' || !recordingFilePath.trim()) {
            throw new Error('Invalid recording file path');
        }

        return service.createSessionFromRecordingFile(recordingFilePath);
    });

    ipc.handle('sessions:optimize-audio', async (_event, sessionId: unknown) => {
        if (typeof sessionId !== 'string' || !sessionId.trim()) {
            throw new Error('Invalid session id');
        }

        return service.optimizeSessionAudio(sessionId);
    });

    ipc.handle('sessions:reveal-root', async () => {
        return service.revealSessionsFolder();
    });
}
