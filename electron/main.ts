import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { spawn } from 'child_process';

let mainWindow: BrowserWindow | null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const isDev = process.env.NODE_ENV !== 'production';
  const devUrl = 'http://localhost:5173';
  const startUrl = isDev
    ? devUrl
    : `file://${path.join(__dirname, '../renderer/index.html')}`;

  mainWindow.loadURL(startUrl);
}

app.whenReady().then(createWindow);
ipcMain.handle('transcribe', async (_event, language: string) => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'flac'] }],
    properties: ['openFile']
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
    DYLD_LIBRARY_PATH: binPath
  };

  return new Promise<string>((resolve, reject) => {
    try {
        const proc = spawn(binPath, [
            '-m', modelPath,
            '-l', lang,
            '-f', audioPath
        ], { env });

      let output = '';

      proc.stdout.on('data', (data) => (output += data.toString()));
      proc.stderr.on('data', (data) => console.error(data.toString()));
      proc.on('error', (err) => reject(err));
      proc.on('close', () => resolve(output));
    } catch (e) {
      reject(e);
    }
  });
});

app.on('window-all-closed', () => app.quit());
