import type { BrowserWindow, IpcMain } from 'electron';
import { SessionSpeakerWorkflow } from '../services/SessionSpeakerWorkflow';
import { SpeakerDiarizationService } from '../services/SpeakerDiarizationService';
import type { SessionsService } from '../services/SessionsService';
import type { SessionRawSpan, SessionSpeakerAssignment } from '../types/sessions';

const sessionIdFrom = (value: unknown): string => {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid session id');
    return value;
};

const speakerIdFrom = (value: unknown): string => {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid speaker id');
    return value;
};

export function registerSpeakerController(
    ipc: IpcMain,
    getMainWindow: () => BrowserWindow | null,
    sessions: SessionsService,
    isTranscriptionBusy: () => boolean,
): SessionSpeakerWorkflow {
    const workflow = new SessionSpeakerWorkflow(
        sessions,
        new SpeakerDiarizationService(),
        (event) => getMainWindow()?.webContents.send('sessions:speaker-analysis-progress', event),
    );
    const ensureAvailable = () => {
        if (isTranscriptionBusy()) throw new Error('Another operation is in progress');
    };
    const ensureEditable = () => {
        ensureAvailable();
        if (workflow.isBusy) throw new Error('Speaker analysis is in progress');
    };
    const safe = async <T>(operation: string, action: () => T | Promise<T>): Promise<T> => {
        try {
            return await action();
        } catch (error) {
            console.error(`Speaker ${operation} failed`, error);
            throw new Error('Speaker action failed.');
        }
    };

    ipc.handle('sessions:get-speaker-assets', () => safe('asset status', () => workflow.getAssetStatus()));
    ipc.handle('sessions:prepare-speaker-assets', (_event, includeCuda: unknown) => safe('asset preparation', () => {
        ensureAvailable();
        if (typeof includeCuda !== 'boolean') throw new Error('Invalid asset request');
        return workflow.prepareAssets(includeCuda);
    }));
    ipc.handle('sessions:analyze-speakers', (_event, sessionId: unknown, options: unknown) => safe('analysis', () => {
        ensureAvailable();
        if (!options || typeof options !== 'object' || Array.isArray(options)) {
            throw new Error('Invalid speaker options');
        }
        return workflow.analyze(sessionIdFrom(sessionId), options);
    }));
    ipc.handle('sessions:stop-speaker-analysis', () => safe('stop', () => workflow.stopAndWait()));
    ipc.handle('sessions:rename-speaker', (_event, sessionId: unknown, speakerId: unknown, name: unknown) => safe('rename', () => {
        ensureEditable();
        if (typeof name !== 'string') throw new Error('Invalid speaker name');
        return workflow.rename(sessionIdFrom(sessionId), speakerIdFrom(speakerId), name);
    }));
    ipc.handle('sessions:assign-speaker', (_event, sessionId: unknown, span: unknown, speakerId: unknown) => safe('assignment', () => {
        ensureEditable();
        if (!span || typeof span !== 'object' || Array.isArray(span)) throw new Error('Invalid transcript span');
        if (speakerId !== null) speakerIdFrom(speakerId);
        return workflow.assign(sessionIdFrom(sessionId), span as SessionRawSpan | SessionSpeakerAssignment, speakerId as string | null);
    }));
    ipc.handle('sessions:merge-speakers', (_event, sessionId: unknown, sourceId: unknown, targetId: unknown) => safe('merge', () => {
        ensureEditable();
        return workflow.merge(sessionIdFrom(sessionId), speakerIdFrom(sourceId), speakerIdFrom(targetId));
    }));
    return workflow;
}
