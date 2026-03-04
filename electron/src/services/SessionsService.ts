import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { app, shell } from 'electron';
import type {
    SessionDetails,
    SessionFileV1,
    SessionListItem,
    SessionTranscriptV1,
    SessionTranscriptionInfo,
} from '../types/sessions';
import { AudioPreprocessor } from './AudioPreprocessor';

const SESSION_FILE_NAME = 'session.json';
const SESSION_VERSION = 1 as const;
const TRANSCRIPT_FILE_RELATIVE_PATH = path.join('transcript', 'transcript.v1.json');
const ORIGINAL_AUDIO_DIR = 'audio';
const SESSION_WAV_RELATIVE_PATH = path.join(ORIGINAL_AUDIO_DIR, 'source.wav');
const SESSION_OPTIMIZED_WAV_RELATIVE_PATH = path.join(ORIGINAL_AUDIO_DIR, 'optimized.wav');
const SESSION_WAV_CONVERT_OPTIONS = {} as const;
const SESSION_OPTIMIZED_WAV_CONVERT_OPTIONS = {
    lowPass: 12000,
    highPass: 80,
    dynanorm: true,
} as const;

const formatDateForTitle = (timestampMs: number): string => {
    const date = new Date(timestampMs);
    const yyyy = String(date.getFullYear());
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');

    return `${yyyy}-${mm}-${dd} ${hh}-${min}-${ss}`;
};

const readJsonFile = async <T>(filePath: string): Promise<T> => {
    const raw = await fs.readFile(filePath, 'utf8');

    return JSON.parse(raw) as T;
};

const writeJsonFile = async (filePath: string, value: unknown): Promise<void> => {
    const dir = path.dirname(filePath);

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
};

const getErrnoCode = (error: unknown): string | null => {
    if (!error || typeof error !== 'object') return null;

    const record = error as Record<string, unknown>;
    const code = record.code;

    return typeof code === 'string' ? code : null;
};

const moveFile = async (sourcePath: string, targetPath: string): Promise<void> => {
    try {
        await fs.rename(sourcePath, targetPath);
    } catch (error) {
        const code = getErrnoCode(error);

        if (code !== 'EXDEV') {
            throw error;
        }

        await fs.copyFile(sourcePath, targetPath);
        await fs.unlink(sourcePath);
    }
};

const toListItem = (session: SessionFileV1): SessionListItem => ({
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    sourceKind: session.sourceKind,
    hasTranscript: Boolean(session.transcript?.path),
});

export class SessionsService {
    private readonly audioPreprocessor = new AudioPreprocessor();

    public getSessionsRootDir(): string {
        return path.join(app.getPath('userData'), 'sessions');
    }

    public async revealSessionsFolder(): Promise<boolean> {
        const sessionsRoot = this.getSessionsRootDir();

        await fs.mkdir(sessionsRoot, { recursive: true });

        const result = await shell.openPath(sessionsRoot);

        return result === '';
    }

    public async deleteSession(sessionId: string): Promise<void> {
        if (!sessionId || typeof sessionId !== 'string') {
            throw new Error('Invalid session id');
        }

        const trimmed = sessionId.trim();

        if (!trimmed || trimmed === '.' || trimmed === '..' || /[\\/]/.test(trimmed)) {
            throw new Error('Invalid session id');
        }

        const sessionsRoot = this.getSessionsRootDir();
        const resolvedRoot = path.resolve(sessionsRoot);
        const targetDir = path.join(sessionsRoot, trimmed);
        const resolvedTarget = path.resolve(targetDir);

        if (!resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
            throw new Error('Invalid session path');
        }

        await fs.rm(resolvedTarget, { recursive: true, force: true });
    }

    public async listSessions(): Promise<SessionListItem[]> {
        const sessionsRoot = this.getSessionsRootDir();

        let entries: Array<import('fs').Dirent> = [];

        try {
            entries = await fs.readdir(sessionsRoot, { withFileTypes: true });
        } catch {
            return [];
        }

        const sessions: SessionListItem[] = [];

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const sessionDir = path.join(sessionsRoot, entry.name);
            const sessionFilePath = path.join(sessionDir, SESSION_FILE_NAME);

            try {
                const session = await readJsonFile<SessionFileV1>(sessionFilePath);

                if (!session || session.version !== SESSION_VERSION) continue;

                sessions.push(toListItem(session));
            } catch {
                // ignore invalid session entries
            }
        }

        sessions.sort((a, b) => b.updatedAt - a.updatedAt);

        return sessions;
    }

    public async getSession(sessionId: string): Promise<SessionDetails> {
        const sessionsRoot = this.getSessionsRootDir();
        const sessionDir = path.join(sessionsRoot, sessionId);
        const sessionFilePath = path.join(sessionDir, SESSION_FILE_NAME);

        const session = await readJsonFile<SessionFileV1>(sessionFilePath);

        if (!session || session.version !== SESSION_VERSION) {
            throw new Error('Invalid session file');
        }

        const audioOriginalPath = path.join(sessionDir, session.audio.originalPath);
        const wavResult = await this.ensureSessionWavFile(sessionDir, sessionFilePath, session);
        const audioWavPath = wavResult.wavPath;
        const resolvedSession = wavResult.session;

        const audioOptimizedWavPath = resolvedSession.audio.optimizedWavPath
            ? path.join(sessionDir, resolvedSession.audio.optimizedWavPath)
            : undefined;

        let transcript: SessionTranscriptV1 | undefined;

        if (resolvedSession.transcript?.path) {
            const transcriptPath = path.join(sessionDir, resolvedSession.transcript.path);

            try {
                transcript = await readJsonFile<SessionTranscriptV1>(transcriptPath);
            } catch {
                transcript = undefined;
            }
        }

        return {
            ...toListItem(resolvedSession),
            audioOriginalPath,
            audioWavPath,
            audioOptimizedWavPath,
            transcript,
        };
    }

    public async createSessionFromImport(sourcePath: string): Promise<SessionDetails> {
        if (!sourcePath || typeof sourcePath !== 'string') {
            throw new Error('Invalid source path');
        }

        const createdAt = Date.now();
        const sessionId = randomUUID();
        const sessionsRoot = this.getSessionsRootDir();
        const sessionDir = path.join(sessionsRoot, sessionId);
        const audioDir = path.join(sessionDir, ORIGINAL_AUDIO_DIR);

        await fs.mkdir(audioDir, { recursive: true });

        const sourceExt = path.extname(sourcePath) || '';
        const safeExt = sourceExt && sourceExt.length <= 10 ? sourceExt : '';
        const originalFileName = path.basename(sourcePath) || `audio${safeExt || ''}`;
        const audioRelativePath = path.join(ORIGINAL_AUDIO_DIR, `original${safeExt || ''}`);
        const targetAudioPath = path.join(sessionDir, audioRelativePath);

        await fs.copyFile(sourcePath, targetAudioPath);

        const targetWavPath = path.join(sessionDir, SESSION_WAV_RELATIVE_PATH);
        const { path: tmpWavPath, cleanup } = await this.audioPreprocessor.convertAudio({
            audioPath: targetAudioPath,
            ...SESSION_WAV_CONVERT_OPTIONS,
        });

        try {
            await fs.mkdir(path.dirname(targetWavPath), { recursive: true });
            await fs.copyFile(tmpWavPath, targetWavPath);
        } finally {
            await cleanup().catch(() => void 0);
        }

        const wavRelativePath = SESSION_WAV_RELATIVE_PATH;

        const sessionFile: SessionFileV1 = {
            version: SESSION_VERSION,
            id: sessionId,
            title: originalFileName,
            createdAt,
            updatedAt: createdAt,
            sourceKind: 'imported',
            audio: {
                originalFileName,
                originalPath: audioRelativePath,
                wavPath: wavRelativePath,
            },
        };

        await writeJsonFile(path.join(sessionDir, SESSION_FILE_NAME), sessionFile);

        return this.getSession(sessionId);
    }

    public async createSessionFromRecordingFile(recordingFilePath: string): Promise<SessionDetails> {
        if (!recordingFilePath || typeof recordingFilePath !== 'string') {
            throw new Error('Invalid recording file path');
        }

        const createdAt = Date.now();
        const sessionId = randomUUID();
        const sessionsRoot = this.getSessionsRootDir();
        const sessionDir = path.join(sessionsRoot, sessionId);
        const audioDir = path.join(sessionDir, ORIGINAL_AUDIO_DIR);

        await fs.mkdir(audioDir, { recursive: true });

        const sourceExt = path.extname(recordingFilePath) || '.wav';
        const safeExt = sourceExt && sourceExt.length <= 10 ? sourceExt : '.wav';
        const originalFileName = `recording-${formatDateForTitle(createdAt)}${safeExt}`;
        const audioRelativePath = path.join(ORIGINAL_AUDIO_DIR, `original${safeExt}`);
        const targetAudioPath = path.join(sessionDir, audioRelativePath);

        await moveFile(recordingFilePath, targetAudioPath);

        const targetWavPath = path.join(sessionDir, SESSION_WAV_RELATIVE_PATH);
        const { path: tmpWavPath, cleanup } = await this.audioPreprocessor.convertAudio({
            audioPath: targetAudioPath,
            ...SESSION_WAV_CONVERT_OPTIONS,
        });

        try {
            await fs.mkdir(path.dirname(targetWavPath), { recursive: true });
            await fs.copyFile(tmpWavPath, targetWavPath);
        } finally {
            await cleanup().catch(() => void 0);
        }

        const sessionFile: SessionFileV1 = {
            version: SESSION_VERSION,
            id: sessionId,
            title: originalFileName,
            createdAt,
            updatedAt: createdAt,
            sourceKind: 'recorded',
            audio: {
                originalFileName,
                originalPath: audioRelativePath,
                wavPath: SESSION_WAV_RELATIVE_PATH,
            },
        };

        await writeJsonFile(path.join(sessionDir, SESSION_FILE_NAME), sessionFile);

        return this.getSession(sessionId);
    }

    public async optimizeSessionAudio(sessionId: string): Promise<SessionDetails> {
        if (!sessionId) {
            throw new Error('Session id is required');
        }

        const sessionsRoot = this.getSessionsRootDir();
        const sessionDir = path.join(sessionsRoot, sessionId);
        const sessionFilePath = path.join(sessionDir, SESSION_FILE_NAME);

        const session = await readJsonFile<SessionFileV1>(sessionFilePath);

        if (!session || session.version !== SESSION_VERSION) {
            throw new Error('Invalid session file');
        }

        const wavRelativePath = session.audio.wavPath;

        if (!wavRelativePath) {
            throw new Error('Session has no WAV file to optimize');
        }

        const wavAbsolutePath = path.join(sessionDir, wavRelativePath);
        const targetOptimizedPath = path.join(sessionDir, SESSION_OPTIMIZED_WAV_RELATIVE_PATH);

        const { path: tmpWavPath, cleanup } = await this.audioPreprocessor.convertAudio({
            audioPath: wavAbsolutePath,
            ...SESSION_OPTIMIZED_WAV_CONVERT_OPTIONS,
        });

        try {
            await fs.mkdir(path.dirname(targetOptimizedPath), { recursive: true });
            await fs.copyFile(tmpWavPath, targetOptimizedPath);
        } finally {
            await cleanup().catch(() => void 0);
        }

        const updatedAt = Date.now();
        const updatedSession: SessionFileV1 = {
            ...session,
            updatedAt,
            audio: {
                ...session.audio,
                optimizedWavPath: SESSION_OPTIMIZED_WAV_RELATIVE_PATH,
            },
        };

        await writeJsonFile(sessionFilePath, updatedSession);

        return this.getSession(sessionId);
    }

    public async saveTranscript(
        sessionId: string,
        transcript: SessionTranscriptV1,
        transcription?: SessionTranscriptionInfo,
    ): Promise<void> {
        if (!sessionId) {
            throw new Error('Session id is required');
        }

        const sessionsRoot = this.getSessionsRootDir();
        const sessionDir = path.join(sessionsRoot, sessionId);
        const sessionFilePath = path.join(sessionDir, SESSION_FILE_NAME);

        const session = await readJsonFile<SessionFileV1>(sessionFilePath);

        if (!session || session.version !== SESSION_VERSION) {
            throw new Error('Invalid session file');
        }

        const updatedAt = Date.now();

        session.updatedAt = updatedAt;
        session.transcript = { path: TRANSCRIPT_FILE_RELATIVE_PATH };
        session.transcription = transcription;

        const transcriptPath = path.join(sessionDir, TRANSCRIPT_FILE_RELATIVE_PATH);

        await writeJsonFile(transcriptPath, transcript);
        await writeJsonFile(sessionFilePath, session);
    }

    private async ensureSessionWavFile(
        sessionDir: string,
        sessionFilePath: string,
        session: SessionFileV1,
    ): Promise<{ wavPath: string; session: SessionFileV1 }> {
        const explicitWavRelativePath = session.audio.wavPath?.trim() || null;
        const fallbackWavRelativePath = path.extname(session.audio.originalPath).toLowerCase() === '.wav'
            ? session.audio.originalPath
            : null;
        const existingRelativePath = explicitWavRelativePath ?? fallbackWavRelativePath;

        if (existingRelativePath) {
            const wavPath = path.join(sessionDir, existingRelativePath);

            try {
                await fs.access(wavPath);

                return { wavPath, session };
            } catch {
                // fallthrough to re-generate the file
            }
        }

        const originalAbsolutePath = path.join(sessionDir, session.audio.originalPath);
        const targetWavPath = path.join(sessionDir, SESSION_WAV_RELATIVE_PATH);
        const { path: tmpWavPath, cleanup } = await this.audioPreprocessor.convertAudio({
            audioPath: originalAbsolutePath,
            ...SESSION_WAV_CONVERT_OPTIONS,
        });

        try {
            await fs.mkdir(path.dirname(targetWavPath), { recursive: true });
            await fs.copyFile(tmpWavPath, targetWavPath);
        } finally {
            await cleanup().catch(() => void 0);
        }

        const updatedAt = Date.now();
        const updatedSession: SessionFileV1 = {
            ...session,
            updatedAt,
            audio: {
                ...session.audio,
                wavPath: SESSION_WAV_RELATIVE_PATH,
            },
        };

        await writeJsonFile(sessionFilePath, updatedSession);

        return { wavPath: targetWavPath, session: updatedSession };
    }
}
