import type { BrowserWindow } from 'electron';
import { formatActivityFailure } from '../utils/errorDetails';

export const reportActivityFailure = (window: BrowserWindow | null, action: string, error: unknown): void => {
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send('transcribe:log', `\n${formatActivityFailure(action, error)}\n`);
    }
};
