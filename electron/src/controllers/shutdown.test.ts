import { expect, it, vi } from 'vitest';
import { TranscriptionService } from '../services/TranscriptionService';

const lifecycle = vi.hoisted(() => ({
    events: new Map<string, (...args: unknown[]) => unknown>(),
    ipc: new Map<string, (...args: unknown[]) => unknown>(),
    quit: vi.fn(),
    cleanup: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    stopSpeakers: vi.fn<() => Promise<boolean>>(),
    readSession: vi.fn<() => Promise<{ audioOriginalPath: string }>>(),
    prepareAudio: vi.fn().mockResolvedValue('optimized.wav'),
    transcribe: vi.fn().mockResolvedValue({ text: '', segments: [] }),
}));

vi.mock('electron', () => ({
    app: {
        isPackaged: false,
        requestSingleInstanceLock: () => true,
        whenReady: () => Promise.resolve(),
        on: (name: string, listener: (...args: unknown[]) => unknown) => lifecycle.events.set(name, listener),
        quit: lifecycle.quit,
    },
    BrowserWindow: class {
        loadURL = () => Promise.resolve();
        on = vi.fn();
        webContents = { send: vi.fn() };
    },
    screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1200, height: 800 } }) },
    protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
    ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => lifecycle.ipc.set(channel, handler) },
}));
vi.mock('../services/AudioPreprocessor', () => ({ cleanupAudioTempDirs: lifecycle.cleanup }));
vi.mock('../services/SessionsService', () => ({ SessionsService: class {
    getSession = lifecycle.readSession;
    prepareSourceAudio = lifecycle.prepareAudio;
    saveTranscript = () => Promise.resolve();
} }));
vi.mock('../services/RecordingArchive', () => ({ RecordingArchive: class {} }));
vi.mock('../services/whisperServer/Whisper', () => ({ Whisper: class {
    startServer = () => Promise.resolve();
    stop = () => false;
    transcribeResult = lifecycle.transcribe;
} }));
vi.mock('../utils/whisper', () => ({ resolveWhisperPaths: () => ({ serverBinPath: 'whisper', modelPath: 'model', vadModelPath: 'vad' }) }));
vi.mock('../services/SpeakerDiarizationService', () => ({ SpeakerDiarizationService: class {} }));
vi.mock('../services/SessionSpeakerWorkflow', () => ({ SessionSpeakerWorkflow: class {
    isBusy = false;
    stopAndWait = lifecycle.stopSpeakers;
} }));
vi.mock('./debugController', () => ({ registerDebugController: vi.fn() }));
vi.mock('./fileController', () => ({ registerFileController: vi.fn() }));
vi.mock('./recordingController', () => ({ registerRecordingController: vi.fn() }));
vi.mock('./sessionsController', () => ({ registerSessionsController: vi.fn() }));
vi.mock('./whisperModelController', () => ({ registerWhisperModelController: vi.fn() }));
vi.mock('./uiPreferencesController', () => ({ registerUiPreferencesController: vi.fn(), getUiPreferenceValue: () => 1000 }));

it('waits for speech preparation before cleanup and keeps repeated quits and late starts blocked', async () => {
    let finishSpeakers!: (stopped: boolean) => void;
    let finishSessionRead!: (session: { audioOriginalPath: string }) => void;
    lifecycle.stopSpeakers.mockImplementation(() => new Promise((resolve) => { finishSpeakers = resolve; }));
    lifecycle.readSession.mockImplementation(() => new Promise((resolve) => { finishSessionRead = resolve; }));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stopTranscription = vi.spyOn(TranscriptionService.prototype, 'stopAndWait');
    try {
        await import('../../main.js');
        await vi.waitFor(() => expect(lifecycle.ipc.has('sessions:analyze-speakers')).toBe(true));
        const admitted = lifecycle.ipc.get('transcribeStream')!(undefined, 'audio.wav', { sessionId: 'session' }) as Promise<unknown>;
        const lateResult = admitted.catch((error: unknown) => error);
        const quit = lifecycle.events.get('before-quit')!;
        const first = { preventDefault: vi.fn() };
        quit(first);
        expect(first.preventDefault).toHaveBeenCalledOnce();
        expect(lifecycle.stopSpeakers).toHaveBeenCalledOnce();
        expect(stopTranscription).toHaveBeenCalledOnce();
        expect(lifecycle.cleanup).not.toHaveBeenCalled();

        const repeated = { preventDefault: vi.fn() };
        quit(repeated);
        expect(repeated.preventDefault).toHaveBeenCalledOnce();
        expect(lifecycle.stopSpeakers).toHaveBeenCalledOnce();
        expect(lifecycle.quit).not.toHaveBeenCalled();
        await expect(lifecycle.ipc.get('sessions:analyze-speakers')!(undefined, 'session', {}))
            .rejects.toThrow('Speaker action failed.');
        await expect(lifecycle.ipc.get('transcribeStream')!(undefined, 'audio.wav', {}))
            .rejects.toThrow('Another operation is in progress');
        finishSpeakers(true);
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(lifecycle.cleanup).not.toHaveBeenCalled();
        expect(lifecycle.quit).not.toHaveBeenCalled();
        finishSessionRead({ audioOriginalPath: 'original.wav' });
        const lateError = await lateResult;
        expect(lifecycle.transcribe).not.toHaveBeenCalled();
        expect(lifecycle.prepareAudio).not.toHaveBeenCalled();
        expect(lateError).toMatchObject({ name: 'AbortError' });
        await vi.waitFor(() => expect(lifecycle.quit).toHaveBeenCalledOnce());
        expect(lifecycle.cleanup).toHaveBeenCalledOnce();
        const final = { preventDefault: vi.fn() };
        quit(final);
        expect(final.preventDefault).not.toHaveBeenCalled();
    } finally {
        finishSpeakers?.(true);
        finishSessionRead?.({ audioOriginalPath: 'original.wav' });
        logged.mockRestore();
        stopTranscription.mockRestore();
    }
});
