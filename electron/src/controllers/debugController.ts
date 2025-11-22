import type { BrowserWindow, IpcMain } from 'electron';

export function registerDebugController(ipc: IpcMain, getMainWindow: () => BrowserWindow | null): void {
    ipc.handle('debug:open-devtools', () => {
        const win = getMainWindow();

        if (!win) {
            throw new Error('Main window is not ready yet');
        }

        if (!win.webContents.isDevToolsOpened()) {
            win.webContents.openDevTools({ mode: 'detach' });
        } else {
            win.webContents.devToolsWebContents?.focus();
        }

        return true;
    });
}
