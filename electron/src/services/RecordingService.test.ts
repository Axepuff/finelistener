import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinalizeRecordingResult } from '../types/recordingArchive';
import type { SessionDetails } from '../types/sessions';
import { DEFAULT_WAV_FORMAT } from './AudioPreprocessor';
import { RecordingArchive } from './RecordingArchive';
import { RecordingService, type RecordingResult } from './RecordingService';
import type { CaptureAdapter, CaptureAdapterEvents, CaptureAdapterStartOptions } from './capture/CaptureAdapter';

const session: SessionDetails = {
    id: 'session-1', title: 'Recording', createdAt: 1, updatedAt: 1, sourceKind: 'recorded', hasTranscript: false,
    audioOriginalPath: 'mix.wav', audioWavPath: 'mix.wav',
};

class FakeArchive {
    public prepareCapture = vi.fn(() => Promise.resolve({ recordingId: '00000000-0000-4000-8000-000000000001', outputPath: 'C:/owned/audio/system.wav', startedAt: 1 }));
    public registerCaptureResult = vi.fn(() => Promise.resolve());
    public finalize = vi.fn((): Promise<FinalizeRecordingResult> => Promise.resolve({
        recordingId: '00000000-0000-4000-8000-000000000001', sessionId: session.id, session, sourceWarnings: [],
    }));
}

class FakeAdapter implements CaptureAdapter {
    readonly id = 'fake'; readonly label = 'Fake';
    events: CaptureAdapterEvents | null = null;
    options: CaptureAdapterStartOptions | null = null;
    stopResult: RecordingResult = { filePath: 'C:/owned/audio/system.wav', format: DEFAULT_WAV_FORMAT };
    startRecording = vi.fn((options: CaptureAdapterStartOptions, events: CaptureAdapterEvents) => { this.options = options; this.events = events; return Promise.resolve(); });
    stopRecording = vi.fn(() => Promise.resolve(this.stopResult));
}

describe('RecordingService', () => {
    let adapter: FakeAdapter;
    let archive: FakeArchive;
    beforeEach(() => { adapter = new FakeAdapter(); archive = new FakeArchive(); });

    const createService = (callbacks = {}) => new RecordingService(adapter, callbacks, {
        archive: archive as unknown as RecordingArchive,
    });

    it('returns only an opaque recording id to the renderer and finalizes in main', async () => {
        const service = createService();
        const started = await service.startRecording({ sources: { system: '', microphone: null } });
        expect(started).toEqual({ recordingId: '00000000-0000-4000-8000-000000000001', startedAt: 1 });
        expect(started).not.toHaveProperty('filePath');
        expect(adapter.options?.outputPath).toBe('C:/owned/audio/system.wav');
        const finished = await service.stopRecording();
        expect(archive.registerCaptureResult).toHaveBeenCalledWith(started.recordingId, adapter.stopResult);
        expect(finished.session).toBe(session);
    });

    it('coalesces repeated stop calls', async () => {
        const service = createService();
        await service.startRecording();
        const [first, second] = await Promise.all([service.stopRecording(), service.stopRecording()]);
        expect(adapter.stopRecording).toHaveBeenCalledOnce();
        expect(first).toEqual(second);
    });

    it('finalizes an automatic helper completion and emits one public result', async () => {
        const onFinished = vi.fn();
        const service = createService({ onFinished });
        await service.startRecording();
        adapter.events?.onFinished?.(adapter.stopResult);
        await vi.waitFor(() => expect(onFinished).toHaveBeenCalledOnce());
        expect(onFinished.mock.calls[0][0]).not.toHaveProperty('filePath');
        expect(await service.stopRecording()).toEqual(onFinished.mock.calls[0][0]);
    });

    it('rejects an empty source selection before preparing storage', async () => {
        const service = createService();
        await expect(service.startRecording({ sources: { system: null, microphone: null } })).rejects.toThrow('Select at least one');
        expect(archive.prepareCapture).not.toHaveBeenCalled();
    });
});
