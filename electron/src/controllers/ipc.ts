import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { registerDebugController } from './debugController';
import { registerFileController } from './fileController';
import { registerRecordingController } from './recordingController';
import { registerSessionsController } from './sessionsController';
import { registerTranscriptionController } from './transcriptionController';
import { registerUiPreferencesController } from './uiPreferencesController';
import { registerWhisperModelController } from './whisperModelController';
import { SessionsService } from '../services/SessionsService';
import { RecordingArchive } from '../services/RecordingArchive';
import { getUiPreferenceValue } from './uiPreferencesController';

export function registerIpcHandlers(getMainWindow: () => BrowserWindow | null): void {
    const sessionsService = new SessionsService(getUiPreferenceValue('recordingDerivedCacheBudgetBytes'));
    const recordingArchive = new RecordingArchive({
        sessionsService,
        recoveryQuotaBytes: getUiPreferenceValue('recordingRecoveryQuotaBytes'),
    });
    registerFileController(ipcMain, getMainWindow);
    registerTranscriptionController(ipcMain, getMainWindow, sessionsService);
    registerRecordingController(ipcMain, getMainWindow, recordingArchive);
    registerSessionsController(ipcMain, getMainWindow, sessionsService);
    registerDebugController(ipcMain, getMainWindow);
    registerWhisperModelController(ipcMain, getMainWindow);
    registerUiPreferencesController(ipcMain, getMainWindow);
}
