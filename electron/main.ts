import path from 'path';
import { open } from 'node:fs/promises';
import { pathToFileURL } from 'url';
import { app, BrowserWindow, shell, screen, protocol, net } from 'electron';
import { registerIpcHandlers } from './src/controllers/ipc';
import { cleanupAudioTempDirs } from './src/services/AudioPreprocessor';
import { PlaybackFiles } from './src/services/PlaybackFiles';
import { getFileByteRange } from './src/utils/fileByteRange';

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
let canQuit = false;
let stopBackgroundWork: (() => Promise<void>) | null = null;

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

const MIN_WINDOW_WIDTH = 1024;
const MIN_WINDOW_HEIGHT = 640;

function createMainWindow(): void {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const winWidth = Math.floor(width * 0.9);
    const winHeight = Math.floor(height * 0.9);

    mainWindow = new BrowserWindow({
        width: Math.max(winWidth, MIN_WINDOW_WIDTH),
        height: Math.max(winHeight, MIN_WINDOW_HEIGHT),
        // Narrower windows are not supported: the three workspace panels need 1000px in one row.
        minWidth: MIN_WINDOW_WIDTH,
        minHeight: MIN_WINDOW_HEIGHT,
        // The renderer draws its own 48px title bar; macOS keeps only the window buttons.
        ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 20, y: 18 } } : {}),
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
        if (isQuitting) return;
        createMainWindow();

        app.on('activate', () => {
            if (!isQuitting && BrowserWindow.getAllWindows().length === 0) {
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

        const playbackFiles = new PlaybackFiles();
        stopBackgroundWork = registerIpcHandlers(() => mainWindow, playbackFiles);

        protocol.handle(LOCAL_FILE_PROTOCOL, async (request) => {
            const url = new URL(request.url);

            const pathname = decodeURIComponent(url.pathname);
            const host = url.hostname;

            let filePath = pathname;

            if (host === 'playback') {
                // The first slash separates the URL authority from the encoded native path.
                const playbackPath = pathname.slice(1);
                if (!path.isAbsolute(playbackPath)) return new Response(null, { status: 400 });
                return playbackFiles.serve(path.normalize(playbackPath), request);
            }
            if (process.platform === 'win32') {
                // На Windows восстанавливаем букву диска из host (local-file://c/...) и убираем лишние слэши
                filePath = `${host ? `${host}:` : ''}${pathname}`.replace(/^\/+/, '');
            } else if (host) {
                // Wavesurfer иногда теряет третий слэш и кладёт кусок пути в host; приклеиваем его обратно.
                filePath = path.join('/', host, pathname);
            }

            const normalizedPath = path.normalize(filePath);
            const fileUrl = pathToFileURL(normalizedPath).toString();

            const rangeHeader = request.headers.get('range');
            if (!rangeHeader) return net.fetch(fileUrl, { signal: request.signal });

            const file = await open(normalizedPath, 'r');
            const { size } = await file.stat().finally(() => file.close());
            const range = getFileByteRange(rangeHeader, size);
            if (!range) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });

            // Chromium reads the requested file bytes, but omits the HTTP range metadata needed for seeking.
            const { start, end } = range;
            const response = await net.fetch(fileUrl, { headers: { Range: `bytes=${start}-${end}` }, signal: request.signal });
            if (!response.ok) return response;

            const headers = new Headers(response.headers);
            headers.set('Accept-Ranges', 'bytes');
            headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
            headers.set('Content-Length', String(end - start + 1));

            return new Response(response.body, { status: 206, headers });
        });
    })
    .catch((err) => {
        console.error('[app.whenReady] Error:', err);
        app.quit();
    });

app.on('before-quit', (event) => {
    if (canQuit) return;

    event.preventDefault();
    if (isQuitting) return;
    isQuitting = true;
    // Workers may still be reading temporary audio; wait before deleting it or exiting.
    void (stopBackgroundWork?.() ?? Promise.resolve())
        .then(() => cleanupAudioTempDirs())
        .catch((error: unknown) => console.error('Failed to finish application shutdown', error))
        .finally(() => {
            canQuit = true;
            app.quit();
        });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
