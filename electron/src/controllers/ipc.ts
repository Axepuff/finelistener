import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { registerDebugController } from './debugController';
import { registerFileController } from './fileController';
import { registerRecordingController } from './recordingController';
import { registerTranscriptionController } from './transcriptionController';

export function registerIpcHandlers(getMainWindow: () => BrowserWindow | null): void {
    registerFileController(ipcMain, getMainWindow);
    registerTranscriptionController(ipcMain, getMainWindow);
    registerRecordingController(ipcMain, getMainWindow);
    registerDebugController(ipcMain, getMainWindow);
}
