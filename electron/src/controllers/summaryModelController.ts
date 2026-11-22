import path from 'path';
import { app, type BrowserWindow, type IpcMain } from 'electron';
import { SummaryModelService } from '../services/summaryModel';

export function registerSummaryModelController(ipc: IpcMain, getMainWindow: () => BrowserWindow | null): SummaryModelService {
    const service = new SummaryModelService(path.join(app.getPath('userData'), 'summary-models'), (snapshot) => {
        const window = getMainWindow();
        if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
            window.webContents.send('summary-model:changed', snapshot);
        }
    });
    ipc.handle('summary-model:status', () => service.getStatus());
    ipc.handle('summary-model:download', () => service.download());
    ipc.handle('summary-model:cancel-download', () => service.cancelDownload());
    return service;
}
