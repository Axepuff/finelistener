import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { app, BrowserWindow, ipcMain, dialog } from 'electron';

let mainWindow: BrowserWindow | null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    const isDev = process.env.NODE_ENV !== 'production';
    const offline = process.env.OFFLINE_DEV === '1';

    if (!isDev || offline) {
        const indexHtml = path.join(__dirname, '../renderer/index.html'); // <- dist/renderer/index.html

        mainWindow.loadFile(indexHtml).catch(console.error);
    } else {
        mainWindow.loadURL('http://localhost:5173').catch(console.error);
    }
}

app.whenReady()
    .then(createWindow)
    .catch(console.error);

ipcMain.handle('transcribe', async (_event, language: string) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'flac'] }],
        properties: ['openFile'],
    });

    if (canceled || filePaths.length === 0) return '';

    const audioPath = filePaths[0];
    const isDev = process.env.NODE_ENV !== 'production';

    // Путь к бинарю whisper-cli
    const binPath = isDev
        ? path.resolve(__dirname, '../../whisper.cpp/build/bin/whisper-cli')
        : path.join(process.resourcesPath, 'whisper.cpp', 'build', 'bin', 'whisper-cli');
    // Путь к модели
    const modelPath = isDev
        ? path.resolve(__dirname, '../../whisper.cpp/models/ggml-base.bin')
        : path.join(process.resourcesPath, 'whisper.cpp', 'models', 'ggml-base.bin');

    const lang = language || 'en'; // fallback

    const env = {
        ...process.env,
        DYLD_LIBRARY_PATH: binPath,
    };

    return new Promise<string>((resolve, reject) => {
        try {
            const proc = spawn(binPath, [
                '-m', modelPath,
                '-l', lang,
                '-f', audioPath,
            ], { env });

            let output = '';

            proc.stdout.on('data', (data: Buffer) => (output += data.toString()));
            proc.stderr.on('data', (data: Buffer) => console.error(data.toString()));
            proc.on('error', (err) => reject(err));
            proc.on('close', () => resolve(output));
        } catch (e) {
            if (e instanceof Error) reject(e);
        }
    });
});

ipcMain.handle('saveText', async (_event, content: string) => {
    try {
        const { canceled, filePath } = await dialog.showSaveDialog({
            title: 'Сохранить расшифровку',
            defaultPath: 'transcript.txt',
            filters: [{ name: 'Text', extensions: ['txt'] }],
        });

        if (canceled || !filePath) {
            return { ok: false, error: 'canceled' };
        }
        await fs.writeFile(filePath, content, 'utf8');

        return { ok: true, path: filePath };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        return { ok: false, error: message };
    }
});

app.on('window-all-closed', () => app.quit());
