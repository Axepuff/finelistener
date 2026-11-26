import type { BrowserWindow, IpcMain } from 'electron';
import { dialog } from 'electron';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { SUPPORTED_MEDIA_EXTENSIONS } from '../constants';
import { SessionsService } from '../services/SessionsService';
import type { SessionDetails } from '../types/sessions';

export function registerSessionsController(
    ipc: IpcMain,
    getMainWindow: () => BrowserWindow | null,
    service = new SessionsService(),
): void {
    const prepareForPlayback = (session: SessionDetails): SessionDetails => {
        void service.prepareMissingWaveform(session.id, session.audioMode ?? 'optimized').catch((error: unknown) => {
            console.warn('Failed to prepare background waveform', error);
        });
        return session;
    };
    ipc.handle('sessions:list', async () => {
        return service.listSessions();
    });

    ipc.handle('sessions:get', async (_event, sessionId: unknown) => {
        if (typeof sessionId !== 'string' || !sessionId.trim()) {
            throw new Error('Invalid session id');
        }

        return prepareForPlayback(await service.getSession(sessionId));
    });

    ipc.handle('sessions:set-active', async (_event, sessionId: unknown) => {
        if (sessionId !== null && (typeof sessionId !== 'string' || !sessionId.trim())) throw new Error('Invalid session id');
        await service.setActiveSession(sessionId);
        return true;
    });

    ipc.handle('sessions:get-waveform-peaks', async (_event, sessionId: unknown, mode: unknown) => {
        if (typeof sessionId !== 'string' || (mode !== 'original' && mode !== 'optimized')) throw new Error('Invalid audio choice');
        try {
            return await service.getWaveformPeaks(sessionId, mode);
        } catch (error) {
            console.warn('Failed to prepare session waveform', error);
            throw new Error('Waveform unavailable.');
        }
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
            filters: [
                {
                    name: 'Audio & Video',
                    extensions: SUPPORTED_MEDIA_EXTENSIONS,
                },
            ],
            properties: ['openFile'],
        });

        if (canceled || filePaths.length === 0) return null;

        return prepareForPlayback(await service.createSessionFromImport(filePaths[0]));
    });

    ipc.handle('sessions:import-dropped-audio', async (event, filePath: unknown) => {
        const mainFrame = getMainWindow()?.webContents.mainFrame;

        if (!mainFrame || event.senderFrame !== mainFrame) throw new Error('Invalid audio import sender');
        if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('Invalid audio file path');
        if (!SUPPORTED_MEDIA_EXTENSIONS.includes(path.extname(filePath).slice(1).toLowerCase())) {
            throw new Error('Unsupported audio or video file format');
        }
        if (!(await stat(filePath)).isFile()) throw new Error('Audio import requires a file');

        return prepareForPlayback(await service.createSessionFromImport(filePath));
    });

    ipc.handle('sessions:optimize-audio', async (_event, sessionId: unknown, mode: unknown = 'optimized') => {
        if (typeof sessionId !== 'string' || !sessionId.trim() || (mode !== 'original' && mode !== 'optimized')) throw new Error('Invalid audio choice');
        return prepareForPlayback(await service.optimizeSessionAudio(sessionId, mode));
    });

    ipc.handle('sessions:set-transcript-duplicate-filter', async (
        _event,
        sessionId: unknown,
        enabled: unknown,
    ) => {
        if (typeof sessionId !== 'string' || !sessionId.trim()) {
            throw new Error('Invalid session id');
        }
        if (typeof enabled !== 'boolean') {
            throw new Error('Invalid duplicate filter setting');
        }

        return service.setTranscriptDuplicateFilter(sessionId, enabled);
    });

    ipc.handle('sessions:reveal-folder', async (_event, sessionId: unknown) => {
        if (typeof sessionId !== 'string' || !sessionId.trim()) {
            throw new Error('Invalid session id');
        }

        return service.revealSessionFolder(sessionId);
    });
}
