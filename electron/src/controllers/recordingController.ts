import fs from 'fs';
import path from 'path';
import { app, shell, type BrowserWindow, type IpcMain } from 'electron';
import { RecordingService, type RecordingStartOptions } from '../services/RecordingService';
import { AudioteeAdapter } from '../services/capture/AudioteeAdapter';
import type { CaptureAdapter } from '../services/capture/CaptureAdapter';
import { MiniAudioAdapter, MINIAUDIO_WAV_FORMAT } from '../services/capture/MiniAudioAdapter';
import type { ScreenRecordingPermissionStatus } from '../services/capture/ScreenCaptureKitAdapter';

const toErrorPayload = (error: Error) => ({ message: error.message });

type RecordingPermissionAdapter = {
    getPermissionStatus: () => ScreenRecordingPermissionStatus;
    openScreenRecordingPreferences: () => void;
};

const supportsPermissionStatus = (adapter: CaptureAdapter): adapter is CaptureAdapter & RecordingPermissionAdapter => {
    const candidate = adapter as Partial<RecordingPermissionAdapter>;

    return typeof candidate.getPermissionStatus === 'function';
};

const supportsOpenPreferences = (adapter: CaptureAdapter): adapter is CaptureAdapter & RecordingPermissionAdapter => {
    const candidate = adapter as Partial<RecordingPermissionAdapter>;

    return typeof candidate.openScreenRecordingPreferences === 'function';
};

export function registerRecordingController(ipc: IpcMain, getMainWindow: () => BrowserWindow | null): void {
    const adapter: CaptureAdapter = createRecordingAdapter();
    const serviceConfig = adapter instanceof MiniAudioAdapter
        ? { defaultFormat: MINIAUDIO_WAV_FORMAT }
        : undefined;
    const service = new RecordingService(adapter, {
        onStateChange: (state) => getMainWindow()?.webContents.send('recording:state', state),
        onProgress: (progress) => getMainWindow()?.webContents.send('recording:progress', progress),
        onLevel: (level) => getMainWindow()?.webContents.send('recording:level', level),
        onError: (error) => getMainWindow()?.webContents.send('recording:error', toErrorPayload(error)),
    }, serviceConfig);

    ipc.handle('recording:is-available', async () => {
        if (!adapter.isAvailable) return true;

        return adapter.isAvailable();
    });

    ipc.handle('recording:get-permission-status', () => {
        if (supportsPermissionStatus(adapter)) {
            return adapter.getPermissionStatus();
        }

        return 'unknown' satisfies ScreenRecordingPermissionStatus;
    });

    ipc.handle('recording:open-permission-preferences', () => {
        if (supportsOpenPreferences(adapter)) {
            adapter.openScreenRecordingPreferences();
        }

        return true;
    });

    ipc.handle('recording:get-state', () => service.getState());

    ipc.handle('recording:list-devices', async () => {
        if (adapter.listDevices) {
            return adapter.listDevices();
        }

        return [];
    });

    ipc.handle('recording:reveal-dev-app', () => {
        if (process.platform !== 'darwin') return false;

        const devRoot = process.env.FINELISTENER_DEV_ROOT;

        if (!devRoot) return false;

        const devAppPath = path.resolve(devRoot, 'out', 'dev', 'FineListener Dev.app');

        if (!fs.existsSync(devAppPath)) return false;

        shell.showItemInFolder(devAppPath);

        return true;
    });

    ipc.handle('recording:start', async (_event, options?: RecordingStartOptions) => {
        if (adapter.isAvailable && !(await adapter.isAvailable())) {
            throw new Error(`${adapter.label} is not available.`);
        }

        return service.startRecording(options ?? {});
    });

    ipc.handle('recording:stop', async () => service.stopRecording());
}

function createRecordingAdapter(): CaptureAdapter {
    if (process.platform === 'win32') {
        return new MiniAudioAdapter();
    }

    // const preference = process.env.RECORDING_ADAPTER ?? 'audiotee';
    const audioteeBinaryPath = resolveAudioteeBinaryPath();

    return new AudioteeAdapter({
        binaryPath: audioteeBinaryPath,
    });
}

function resolveAudioteeBinaryPath(): string | undefined {
    const devPath = path.resolve(app.getAppPath(), 'node_modules', 'audiotee', 'bin', 'audiotee');
    const electronResourcesPath = path.resolve(process.execPath, '..', '..', 'Resources');
    const devBundledPath = path.resolve(electronResourcesPath, 'audiotee');
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? app.getAppPath();
    const packagedPath = path.resolve(
        resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        'audiotee',
        'bin',
        'audiotee',
    );
    const candidates = app.isPackaged
        ? [packagedPath, devBundledPath, devPath]
        : [devBundledPath, devPath, packagedPath];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return undefined;
}
