import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { registerDebugController } from './debugController';
import { registerFileController } from './fileController';
import { registerRecordingController } from './recordingController';
import { registerSessionsController } from './sessionsController';
import { registerTranscriptionController } from './transcriptionController';
import { registerUiPreferencesController } from './uiPreferencesController';
import { registerWhisperModelController } from './whisperModelController';
import { registerSpeakerController } from './speakerController';
import { SessionsService } from '../services/SessionsService';
import { RecordingArchive } from '../services/RecordingArchive';
import { getUiPreferenceValue } from './uiPreferencesController';

export function registerIpcHandlers(getMainWindow: () => BrowserWindow | null): () => Promise<void> {
    const sessionsService = new SessionsService(getUiPreferenceValue('recordingDerivedCacheBudgetBytes'));
    const recordingArchive = new RecordingArchive({
        sessionsService,
        recoveryQuotaBytes: getUiPreferenceValue('recordingRecoveryQuotaBytes'),
    });
    registerFileController(ipcMain, getMainWindow);
    let shuttingDown = false;
    let speakerBusy = () => false;
    const transcriptionService = registerTranscriptionController(ipcMain, getMainWindow, sessionsService, () => shuttingDown || speakerBusy());
    const speakerWorkflow = registerSpeakerController(ipcMain, getMainWindow, sessionsService, () => shuttingDown || transcriptionService.isBusy);
    speakerBusy = () => speakerWorkflow.isBusy;
    registerRecordingController(ipcMain, getMainWindow, recordingArchive);
    registerSessionsController(ipcMain, getMainWindow, sessionsService);
    registerDebugController(ipcMain, getMainWindow);
    registerWhisperModelController(ipcMain, getMainWindow);
    registerUiPreferencesController(ipcMain, getMainWindow);

    return async () => {
        shuttingDown = true;
        const stopped = await Promise.allSettled([speakerWorkflow.stopAndWait(), transcriptionService.stopAndWait()]);
        const failures = stopped.filter((result) => result.status === 'rejected').map((result): unknown => result.reason);
        if (failures.length > 0) throw new AggregateError(failures, 'Failed to stop speech processing');
    };
}
