import path from 'path';
import { app, BrowserWindow, shell, screen } from 'electron';
import { registerIpcHandlers } from './src/controllers/ipc';

let mainWindow: BrowserWindow | null = null;

// Use Electron's runtime flag instead of NODE_ENV which may be undefined in packaged apps
const IS_DEV = !app.isPackaged;
const RENDERER_DEV_URL = 'http://localhost:5173';
const RENDERER_DIST_INDEX = path.join(__dirname, '../renderer/index.html');

function createMainWindow(): void {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const winWidth = Math.floor(width * 0.8);
    const winHeight = Math.floor(height * 0.8);

    mainWindow = new BrowserWindow({
        width: winWidth,
        height: winHeight,
        show: true,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            devTools: IS_DEV,
        },
    });

    if (!IS_DEV) {
        mainWindow.loadFile(RENDERER_DIST_INDEX).catch((err) => console.error('[loadFile]', err));
    } else {
        mainWindow.loadURL(RENDERER_DEV_URL).catch((err) => console.error('[loadURL]', err));
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}

app.whenReady()
    .then(() => {
        createMainWindow();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createMainWindow();
            }
        });

        app.on('web-contents-created', (_e, contents) => {
            contents.on('will-navigate', (event) => event.preventDefault());
            contents.setWindowOpenHandler(({ url }) => {
                shell.openExternal(url).catch(() => void 0);

                return { action: 'deny' };
            });
        });

        registerIpcHandlers(() => mainWindow);
    })
    .catch((err) => {
        console.error('[app.whenReady] Error:', err);
        app.quit();
    });

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
