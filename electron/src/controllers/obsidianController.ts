import { app, dialog, shell, type BrowserWindow, type IpcMain, type OpenDialogOptions } from 'electron';
import { ObsidianNotes } from '../services/ObsidianNotes';
import type { ObsidianOptions } from '../types/obsidian';

export function registerObsidianController(ipc: IpcMain, getMainWindow: () => BrowserWindow | null): void {
    let service: ObsidianNotes | undefined;
    const notes = () => (service ??= new ObsidianNotes(app.getPath('userData')));
    ipc.handle('obsidian:get-options', () => {
        try {
            return notes().getOptions();
        } catch (error) {
            console.error('Failed to read Obsidian export options', error);
            throw new Error('Could not read export options.');
        }
    });
    ipc.handle('obsidian:choose-folder', async () => {
        try {
            const options: OpenDialogOptions = { title: 'Choose a folder in your Obsidian vault', properties: ['openDirectory'] };
            const parent = getMainWindow();
            const result = await (parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options));
            if (result.canceled || !result.filePaths[0]) return null;
            return await notes().selectDirectory(result.filePaths[0]);
        } catch (error) {
            console.error('Failed to choose an Obsidian export folder', error);
            throw new Error('Could not select the folder.');
        }
    });
    ipc.handle('obsidian:save-options', (_event, options: ObsidianOptions) => {
        try {
            return notes().saveOptions(options);
        } catch (error) {
            console.error('Failed to save Obsidian export options', error);
            return false;
        }
    });
    ipc.handle('obsidian:export-note', (_event, sessionId: string, title: string, markdown: string, newCopy: boolean) => {
        try {
            return notes().exportNote(sessionId, title, markdown, newCopy);
        } catch (error) {
            console.error('Failed to initialize Obsidian export', error);
            return { status: 'failed' };
        }
    });
    ipc.handle('obsidian:open-note', async (_event, sessionId: string) => {
        try {
            const note = await notes().existingNotePath(sessionId);
            if (!note) return false;
            await shell.openExternal('obsidian://open?path=' + encodeURIComponent(note));
            return true;
        } catch (error) {
            console.error('Failed to open exported Obsidian note', error);
            return false;
        }
    });
}
