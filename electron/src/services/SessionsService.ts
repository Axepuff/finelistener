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
    SessionSourceTrack,
} from '../types/sessions';
import { AudioPreprocessor } from './AudioPreprocessor';
import type { RecordingResult } from './RecordingService';

const SESSION_FILE_NAME = 'session.json';
const SESSION_VERSION = 1 as const;
const TRANSCRIPT_FILE_RELATIVE_PATH = path.join('transcript', 'transcript.v1.json');
const ORIGINAL_AUDIO_DIR = 'audio';
const SESSION_WAV_RELATIVE_PATH = path.join(ORIGINAL_AUDIO_DIR, 'source.wav');
const SESSION_OPTIMIZED_WAV_RELATIVE_PATH = path.join(ORIGINAL_AUDIO_DIR, 'optimized.wav');
const DERIVED_CACHE_INDEX_FILE = '.derived-cache.json';
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
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
    await fs.rename(temporaryPath, filePath);
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
    private readonly derivedGeneration = new Map<string, Promise<void>>();
    private activeSessionId: string | null = null;

    constructor(private readonly derivedCacheBudgetBytes = 1024 * 1024 * 1024) {}

    public getSessionsRootDir(): string {
        return path.join(app.getPath('userData'), 'sessions');
    }

    private resolveSessionDir(sessionId: string): string {
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

        return resolvedTarget;
    }

    public async revealSessionsFolder(): Promise<boolean> {
        const sessionsRoot = this.getSessionsRootDir();

        await fs.mkdir(sessionsRoot, { recursive: true });

        const result = await shell.openPath(sessionsRoot);

        return result === '';
    }

    public async deleteSession(sessionId: string): Promise<void> {
        const sessionDir = this.resolveSessionDir(sessionId);

        await fs.rm(sessionDir, { recursive: true, force: true });
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
        const sessionDir = this.resolveSessionDir(sessionId);
        const sessionFilePath = path.join(sessionDir, SESSION_FILE_NAME);

        const session = await readJsonFile<SessionFileV1>(sessionFilePath);

        if (!session || session.version !== SESSION_VERSION) {
            throw new Error('Invalid session file');
        }

        const audioOriginalPath = path.join(sessionDir, session.audio.originalPath);
        const wavResult = await this.ensureSessionWavFile(sessionDir, sessionFilePath, session);
        const audioWavPath = wavResult.wavPath;
        const resolvedSession = wavResult.session;

        const audioOptimizedWavPath = resolvedSession.audio.optimizedWavPath ?
            path.join(sessionDir, resolvedSession.audio.optimizedWavPath) :
            undefined;

        if (audioOptimizedWavPath) {
            try {
                await fs.access(audioOptimizedWavPath);
            } catch {
                await this.generateOptimizedAudio(audioWavPath, audioOptimizedWavPath);
            }
        }
        await this.touchDerivedFiles(resolvedSession.id, [
            { kind: 'listening', path: audioWavPath },
            ...(audioOptimizedWavPath ? [{ kind: 'optimized' as const, path: audioOptimizedWavPath }] : []),
        ]);
        await this.enforceDerivedCacheBudget(new Set([audioWavPath, ...(audioOptimizedWavPath ? [audioOptimizedWavPath] : [])]));

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
            tracks: resolvedSession.tracks?.map((track) => ({
                ...track,
                filePath: this.resolveTrackPath(sessionDir, track.filePath),
            })),
            sourceWarnings: resolvedSession.sourceWarnings,
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

    public async createSessionFromRecordingFile(recording: string | RecordingResult): Promise<SessionDetails> {
        await this.validateRecordingInput(recording);
        if (typeof recording !== 'string' && recording?.tracks?.length) {
            return this.createSessionFromTracks(recording);
        }
        const recordingFilePath = typeof recording === 'string' ? recording : recording?.filePath;
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

        await fs.copyFile(recordingFilePath, targetAudioPath);

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

        await fs.unlink(recordingFilePath).catch((error: unknown) => {
            console.warn('Failed to remove finalized recording temporary file', error);
        });

        return this.getSession(sessionId);
    }

    public async setActiveSession(sessionId: string | null): Promise<void> {
        if (sessionId !== null) this.resolveSessionDir(sessionId);
        this.activeSessionId = sessionId;
        await this.enforceDerivedCacheBudget(new Set());
    }

    private resolveTrackPath(sessionDir: string, relativePath: string): string {
        const resolved = path.resolve(sessionDir, relativePath);
        if (!resolved.startsWith(`${path.resolve(sessionDir)}${path.sep}`)) {
            throw new Error('Invalid source track path');
        }
        return resolved;
    }

    private async validateRecordingInput(recording: string | RecordingResult): Promise<void> {
        const submittedPaths = typeof recording === 'string' ? [recording] : [
            recording.filePath,
            ...(recording.tracks?.map((track) => track.filePath) ?? []),
        ];
        if (!submittedPaths.length || submittedPaths.some((value) => typeof value !== 'string' || !value.trim())) {
            throw new Error('Invalid recording file path');
        }
        const recordingRoot = path.join(app.getPath('userData'), 'recordings');
        let canonicalRoot: string;
        try { canonicalRoot = await fs.realpath(recordingRoot); }
        catch { throw new Error('Recording storage is not available'); }
        for (const submittedPath of new Set(submittedPaths)) {
            const stat = await fs.lstat(submittedPath);
            if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid recording file');
            const canonicalPath = await fs.realpath(submittedPath);
            const relative = path.relative(canonicalRoot, canonicalPath);
            if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
                throw new Error('Recording file is outside managed storage');
            }
        }
    }

    private async createSessionFromTracks(recording: RecordingResult): Promise<SessionDetails> {
        const inputTracks = recording.tracks!;
        if (inputTracks.length > 2 || new Set(inputTracks.map((track) => track.source)).size !== inputTracks.length) {
            throw new Error('Invalid recording sources');
        }
        for (const track of inputTracks) {
            if (!['system', 'microphone'].includes(track.source) || typeof track.filePath !== 'string'
                || !track.filePath.trim() || !Number.isFinite(track.startOffsetMs ?? 0)
                || (track.startOffsetMs ?? 0) < 0) {
                throw new Error('Invalid recording source');
            }
        }
        const createdAt = Date.now();
        const sessionId = randomUUID();
        const sessionDir = this.resolveSessionDir(sessionId);
        await fs.mkdir(path.join(sessionDir, ORIGINAL_AUDIO_DIR), { recursive: true });
        const tracks: SessionSourceTrack[] = [];
        try {
            for (const track of inputTracks) {
                const relativePath = path.join(ORIGINAL_AUDIO_DIR, `${track.source}.wav`);
                // Keep the temporary originals until the entire session has been finalized.
                await fs.copyFile(track.filePath, path.join(sessionDir, relativePath));
                tracks.push({
                    source: track.source,
                    filePath: relativePath,
                    startOffsetMs: track.startOffsetMs ?? 0,
                    durationMs: track.durationMs,
                    failure: track.failure ?? recording.sourceFailures?.find((failure) => failure.source === track.source)?.message,
                });
            }
            const mixed = await this.audioPreprocessor.mixSources(tracks.map((track) => ({
                ...track, filePath: path.join(sessionDir, track.filePath),
            })));
            try {
                await fs.copyFile(mixed.path, path.join(sessionDir, SESSION_WAV_RELATIVE_PATH));
            } finally {
                await mixed.cleanup();
            }
            const session: SessionFileV1 = {
                version: SESSION_VERSION, id: sessionId,
                title: `recording-${formatDateForTitle(createdAt)}.wav`,
                createdAt, updatedAt: createdAt, sourceKind: 'recorded', tracks,
                audio: {
                    originalFileName: 'recording.wav', originalPath: SESSION_WAV_RELATIVE_PATH,
                    wavPath: SESSION_WAV_RELATIVE_PATH,
                },
            };
            await writeJsonFile(path.join(sessionDir, SESSION_FILE_NAME), session);
        } catch (error) {
            await fs.rm(sessionDir, { recursive: true, force: true });
            throw error;
        }
        for (const track of inputTracks) {
            await fs.unlink(track.filePath).catch((error: unknown) => {
                console.warn('Failed to remove finalized recording temporary file', error);
            });
        }
        return this.getSession(sessionId);
    }

    public async optimizeSessionAudio(sessionId: string): Promise<SessionDetails> {
        const sessionDir = this.resolveSessionDir(sessionId);
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

        await this.generateOptimizedAudio(wavAbsolutePath, targetOptimizedPath);

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
        const sessionDir = this.resolveSessionDir(sessionId);
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
        const fallbackWavRelativePath = path.extname(session.audio.originalPath).toLowerCase() === '.wav' ?
            session.audio.originalPath :
            null;
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
        await this.runDerivedGeneration(targetWavPath, async () => {
            const { path: tmpWavPath, cleanup } = session.tracks?.length ?
                await this.audioPreprocessor.mixSources(session.tracks.map((track) => ({
                    ...track, filePath: this.resolveTrackPath(sessionDir, track.filePath),
                }))) : await this.audioPreprocessor.convertAudio({ audioPath: originalAbsolutePath, ...SESSION_WAV_CONVERT_OPTIONS });
            try {
                await fs.mkdir(path.dirname(targetWavPath), { recursive: true });
                await fs.copyFile(tmpWavPath, targetWavPath);
            } finally { await cleanup().catch(() => void 0); }
        });

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

    private async generateOptimizedAudio(sourcePath: string, targetPath: string): Promise<void> {
        await this.runDerivedGeneration(targetPath, async () => {
            const { path: temporaryPath, cleanup } = await this.audioPreprocessor.convertAudio({
                audioPath: sourcePath, ...SESSION_OPTIMIZED_WAV_CONVERT_OPTIONS,
            });
            try { await fs.mkdir(path.dirname(targetPath), { recursive: true }); await fs.copyFile(temporaryPath, targetPath); }
            finally { await cleanup().catch(() => void 0); }
        });
    }

    private async runDerivedGeneration(targetPath: string, generate: () => Promise<void>): Promise<void> {
        const existing = this.derivedGeneration.get(targetPath);
        if (existing) return existing;
        const operation = generate().finally(() => this.derivedGeneration.delete(targetPath));
        this.derivedGeneration.set(targetPath, operation);
        return operation;
    }

    private async touchDerivedFiles(sessionId: string, files: Array<{ kind: 'listening' | 'optimized'; path: string }>): Promise<void> {
        const indexPath = path.join(this.getSessionsRootDir(), DERIVED_CACHE_INDEX_FILE);
        let index: Record<string, { sessionId: string; kind: 'listening' | 'optimized'; relativePath: string; lastAccessedAt: number }> = {};
        try { index = await readJsonFile<typeof index>(indexPath); } catch { /* Start a new cache index. */ }
        const now = Date.now();
        for (const file of files) {
            try {
                await fs.access(file.path);
                const key = `${sessionId}:${file.kind}`;
                index[key] = { sessionId, kind: file.kind, relativePath: path.relative(this.resolveSessionDir(sessionId), file.path), lastAccessedAt: now };
            } catch { /* Missing derived files are generated when requested. */ }
        }
        await writeJsonFile(indexPath, index);
    }

    private async enforceDerivedCacheBudget(excluded: Set<string>): Promise<void> {
        const indexPath = path.join(this.getSessionsRootDir(), DERIVED_CACHE_INDEX_FILE);
        let index: Record<string, { sessionId: string; kind: 'listening' | 'optimized'; relativePath: string; lastAccessedAt: number }>;
        try { index = await readJsonFile<typeof index>(indexPath); } catch { return; }
        const candidates: Array<{ key: string; path: string; size: number; lastAccessedAt: number }> = [];
        let total = 0;
        for (const [key, entry] of Object.entries(index)) {
            try {
                const sessionDir = this.resolveSessionDir(entry.sessionId);
                const target = this.resolveTrackPath(sessionDir, entry.relativePath);
                const session = await readJsonFile<SessionFileV1>(path.join(sessionDir, SESSION_FILE_NAME));
                const rebuildable = entry.kind === 'optimized' || Boolean(session.tracks?.length)
                    || path.resolve(target) !== path.resolve(sessionDir, session.audio.originalPath);
                if (!rebuildable) { delete index[key]; continue; }
                const stat = await fs.stat(target); total += stat.size;
                candidates.push({ key, path: target, size: stat.size, lastAccessedAt: entry.lastAccessedAt });
            } catch { delete index[key]; }
        }
        candidates.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
        for (const candidate of candidates) {
            if (total <= this.derivedCacheBudgetBytes) break;
            const indexed = index[candidate.key];
            if (excluded.has(candidate.path) || indexed?.sessionId === this.activeSessionId || this.derivedGeneration.has(candidate.path)) continue;
            await fs.rm(candidate.path, { force: true });
            total -= candidate.size; delete index[candidate.key];
        }
        await writeJsonFile(indexPath, index);
    }
}
