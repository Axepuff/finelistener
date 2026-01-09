import fs from 'fs';
import path from 'path';
import { app, type BrowserWindow, type IpcMain } from 'electron';
import type { RecordingStartOptions } from '../services/RecordingService';
import { RecordingService } from '../services/RecordingService';
import { AudioteeAdapter } from '../services/recording/AudioteeAdapter';
import {
    ScreenCaptureKitAdapter,
    type ScreenRecordingPermissionStatus,
} from '../services/recording/ScreenCaptureKitAdapter';

const toErrorPayload = (error: Error) => ({ message: error.message });

export function registerRecordingController(ipc: IpcMain, getMainWindow: () => BrowserWindow | null): void {
    const adapter = createRecordingAdapter();
    const service = new RecordingService(adapter, {
        onStateChange: (state) => getMainWindow()?.webContents.send('recording:state', state),
        onProgress: (progress) => getMainWindow()?.webContents.send('recording:progress', progress),
        onLevel: (level) => getMainWindow()?.webContents.send('recording:level', level),
        onError: (error) => getMainWindow()?.webContents.send('recording:error', toErrorPayload(error)),
    });

    ipc.handle('recording:is-available', async () => {
        if (!adapter.isAvailable) return true;

        return adapter.isAvailable();
    });

    ipc.handle('recording:get-permission-status', () => {
        if ('getPermissionStatus' in adapter && typeof adapter.getPermissionStatus === 'function') {
            return adapter.getPermissionStatus();
        }

        return 'unknown' satisfies ScreenRecordingPermissionStatus;
    });

    ipc.handle('recording:open-permission-preferences', () => {
        if ('openScreenRecordingPreferences' in adapter && typeof adapter.openScreenRecordingPreferences === 'function') {
            adapter.openScreenRecordingPreferences();
        }

        return true;
    });

    ipc.handle('recording:get-state', () => service.getState());

    ipc.handle('recording:start', async (_event, options?: RecordingStartOptions) => {
        if (adapter.isAvailable && !(await adapter.isAvailable())) {
            throw new Error(`${adapter.label} is not available.`);
        }

        return service.startRecording(options ?? {});
    });

    ipc.handle('recording:stop', async () => service.stopRecording());
}

function createRecordingAdapter(): ScreenCaptureKitAdapter | AudioteeAdapter {
    const preference = process.env.RECORDING_ADAPTER ?? 'audiotee';

    if (preference === 'screen-capture-kit') {
        return new ScreenCaptureKitAdapter();
    }

    const audioteeBinaryPath = resolveAudioteeBinaryPath();

    return new AudioteeAdapter({
        binaryPath: audioteeBinaryPath,
    });
}

function resolveAudioteeBinaryPath(): string | undefined {
    const devPath = path.resolve(app.getAppPath(), 'node_modules', 'audiotee', 'bin', 'audiotee');
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? app.getAppPath();
    const packagedPath = path.resolve(
        resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        'audiotee',
        'bin',
        'audiotee',
    );
    const candidates = app.isPackaged ? [packagedPath, devPath] : [devPath, packagedPath];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return undefined;
}
