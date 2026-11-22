import type { SessionDetails } from 'electron/src/types/sessions';
import { createStoryWorkspace } from './storyWorkspace';

export type ErrorScenario = 'incomplete' | 'nothing' | 'previous' | 'speaker' | 'speaker-existing' | 'preparation' | 'permission' | 'storage' | 'source-stopped';

// Controlled IPC substitutes: these never record, download, infer, or open OS settings.
export const createErrorWorkspace = async (scenario: ErrorScenario) => {
    const workspace = await createStoryWorkspace(scenario === 'storage' ? 'sessions-recovery' : scenario === 'permission' ? 'settings-recording-silence' : scenario === 'nothing' ? 'ready' : scenario === 'speaker-existing' ? 'speakers' : 'transcript');
    const { adapter, store } = workspace;
    let session: SessionDetails = structuredClone(await adapter.getSession('storybook-session'));
    const options = { language: 'en', model: 'base' as const, splitOnWord: true, useVad: true };
    if (scenario === 'incomplete' || scenario === 'nothing') {
        session.sourceKind = 'recorded';
        session.tracks = [{ source: 'system', filePath: '/synthetic/system.wav', startOffsetMs: 0 },
            { source: 'microphone', filePath: '/synthetic/microphone.wav', startOffsetMs: 0 }];
        const completed = { startSec: 0, endSec: 1, text: 'Saved system audio.', source: 'system' as const };
        session.transcript = { version: 1, segments: scenario === 'incomplete' ? [completed] : [], sourceRun: {
            status: 'incomplete', settings: options, sources: [
                { source: 'system', status: scenario === 'incomplete' ? 'completed' : 'failed', segments: scenario === 'incomplete' ? [completed] : [] },
                { source: 'microphone', status: 'failed', segments: [] },
            ],
        } };
        adapter.transcribeSession = () => {
            session = { ...session, transcript: { version: 1, segments: [completed, { ...completed, source: 'microphone', text: 'Recovered microphone.' }] } };
            return Promise.resolve(session);
        };
    }
    if (scenario === 'source-stopped') session.tracks = [{ source: 'system', filePath: '/synthetic/system.wav', startOffsetMs: 0, failure: 'Synthetic stopped source' }];
    adapter.getSession = (id) => Promise.resolve(structuredClone({ ...session, id }));
    if (scenario !== 'storage') {
        store.workspace.replaceWorkspace(session);
        store.transcription.replaceSavedTranscript(session.transcript ?? null);
    }
    if (scenario === 'previous') {
        const transcribe = adapter.transcribe;
        adapter.transcribe = () => Promise.reject(new Error('Synthetic transcription failure'));
        await store.startTranscription(options);
        adapter.transcribe = transcribe;
    }
    if (scenario === 'speaker' || scenario === 'speaker-existing' || scenario === 'preparation') {
        await store.speakers.setEnabled(true);
        store.speakers.setAssets({ ready: scenario !== 'preparation', gpuBackend: 'vulkan', gpuAvailable: false, downloadBytes: 123_671_929 });
        if (scenario !== 'preparation') {
            adapter.analyzeSpeakers = () => Promise.reject(new Error('SPEAKER_GPU_UNAVAILABLE'));
            await store.analyzeSpeakers(scenario === 'speaker-existing');
            adapter.analyzeSpeakers = () => Promise.resolve({ ...session, transcript: { ...session.transcript!, speakers: {
                version: 1, recognitionRevision: 'synthetic', generation: 'synthetic', settings: {}, intervals: [], corrections: [], status: 'completed', speakers: [],
            } } });
        } else {
            adapter.prepareSpeakerAssets = () => Promise.reject(new Error('Synthetic component failure'));
            await store.prepareSpeakerAssets();
            adapter.prepareSpeakerAssets = () => Promise.resolve({ ready: true, gpuBackend: 'vulkan', gpuAvailable: false });
        }
    }
    if (scenario === 'permission') {
        adapter.getRecordingPermissionStatus = () => Promise.resolve('denied');
        adapter.startSystemRecording = () => Promise.reject(new Error('Synthetic permission failure'));
        await store.recording.startRecording();
    }
    if (scenario === 'storage') {
        adapter.startSystemRecording = () => Promise.resolve({ error: 'recording-storage-full' });
        await store.recording.startRecording();
    }
    return workspace;
};
