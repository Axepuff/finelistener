import path from 'path';
import { pathToFileURL } from 'url';
import { app, BrowserWindow, shell, screen, protocol, net } from 'electron';
import { registerIpcHandlers } from './src/controllers/ipc';
import { cleanupAudioTempDirs } from './src/services/AudioPreprocessor';

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

const IS_DEV = !app.isPackaged;
const RENDERER_DEV_URL = process.env.RENDERER_DEV_URL ?? 'http://127.0.0.1:5173';
const RENDERER_DIST_INDEX = path.join(__dirname, '../renderer/index.html');
const LOCAL_FILE_PROTOCOL = 'local-file';

protocol.registerSchemesAsPrivileged([
    {
        scheme: LOCAL_FILE_PROTOCOL,
        privileges: {
            secure: true,
            standard: true,
            supportFetchAPI: true,
            stream: true,
            corsEnabled: true,
        },
    },
]);

function createMainWindow(): void {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const winWidth = Math.floor(width * 0.9);
    const winHeight = Math.floor(height * 0.9);

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
            devTools: true,
        },
    });

    if (!IS_DEV) {
        mainWindow.loadFile(RENDERER_DIST_INDEX).catch((err) => console.error('[loadFile]', err));
    } else {
        // mainWindow.webContents.openDevTools();
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
            contents.session.setPermissionRequestHandler((_webContents, permission, callback, details) => {
                const requestUrl = 'requestingUrl' in details ? details.requestingUrl : undefined;

                console.log('[permission]', permission, requestUrl ?? 'unknown', details);
                callback(false);
            });
        });

        registerIpcHandlers(() => mainWindow);

        protocol.handle(LOCAL_FILE_PROTOCOL, (request) => {
            const url = new URL(request.url);

            const pathname = decodeURIComponent(url.pathname);
            const host = url.hostname;

            let filePath = pathname;

            if (process.platform === 'win32') {
                // На Windows восстанавливаем букву диска из host (local-file://c/...) и убираем лишние слэши
                filePath = `${host ? `${host}:` : ''}${pathname}`.replace(/^\/+/, '');
            } else if (host) {
                // Wavesurfer иногда теряет третий слэш и кладёт кусок пути в host; приклеиваем его обратно.
                filePath = path.join('/', host, pathname);
            }

            const normalizedPath = path.normalize(filePath);
            const fileUrl = pathToFileURL(normalizedPath).toString();

            return net.fetch(fileUrl);
        });
    })
    .catch((err) => {
        console.error('[app.whenReady] Error:', err);
        app.quit();
    });

app.on('before-quit', (event) => {
    if (isQuitting) {
        return;
    }

    event.preventDefault();
    isQuitting = true;
    void cleanupAudioTempDirs().finally(() => app.quit());
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
