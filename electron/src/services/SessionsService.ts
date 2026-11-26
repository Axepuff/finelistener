import { createHash, randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { app, shell } from 'electron';
import type {
    SessionAudioMode,
    SessionDetails,
    SessionFileV1,
    SessionListItem,
    SessionSummary,
    SessionSummaryDraft,
    SessionTranscriptV1,
    SessionTranscriptionInfo,
    SessionSourceTrack,
    SessionWaveformPeaks,
} from '../types/sessions';
import { loadWaveformPeaks, readWavDurationMs } from './waveformPeaks';
import { AudioPreprocessor } from './AudioPreprocessor';
import type { RecordingResult } from './RecordingService';
import { deriveSourceTranscript } from './transcriptDuplicateFilter';
import { deriveSpeakerTranscript, getReadableSummary, getReadableSummaryDraft, getSummaryInput, materializeRecognitionTranscript } from './sessionTranscript';

const SESSION_FILE_NAME = 'session.json';
const SESSION_VERSION = 1 as const;
const TRANSCRIPT_FILE_RELATIVE_PATH = path.join('transcript', 'transcript.v1.json');
const ORIGINAL_AUDIO_DIR = 'audio';
export const SESSION_WAV_RELATIVE_PATH = path.join(ORIGINAL_AUDIO_DIR, 'source-original-v1.wav');
const DERIVED_CACHE_INDEX_FILE = '.derived-cache.json';
const SESSION_WAV_CONVERT_OPTIONS = { highPass: undefined, dynanorm: false } as const;
const SESSION_OPTIMIZED_WAV_CONVERT_OPTIONS = {
    lowPass: 12000,
    highPass: 80,
    dynanorm: true,
} as const;

type DerivedCacheKind = 'listening' | 'optimized' | 'waveform-original' | 'waveform-optimized';

const waveformFileName = (mode: SessionAudioMode): string => `waveform-${mode}-v1.peaks`;

const optimizedTarget = async (audioPath: string, microphoneGate = false) => {
    const stat = await fs.stat(audioPath);
    const configuration = microphoneGate ? { ...SESSION_OPTIMIZED_WAV_CONVERT_OPTIONS, microphoneGate: true, dynanorm: false } : SESSION_OPTIMIZED_WAV_CONVERT_OPTIONS;
    const key = createHash('sha256').update(JSON.stringify({ source: path.basename(audioPath), bytes: stat.size,
        modified: stat.mtimeMs, configuration })).digest('hex').slice(0, 20);
    return { target: path.join(path.dirname(audioPath), 'derived', key + '.wav'), configuration };
};

interface DerivedCacheEntry {
    sessionId: string;
    kind: DerivedCacheKind;
    relativePath: string;
    lastAccessedAt: number;
}

type DerivedCacheIndex = Record<string, DerivedCacheEntry>;

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

const writeJsonFile = async (filePath: string, value: unknown, signal?: AbortSignal, beforeCommit?: () => void): Promise<void> => {
    const dir = path.dirname(filePath);

    await fs.mkdir(dir, { recursive: true });
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    try {
        await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
        signal?.throwIfAborted();
        // Windows readers may briefly keep an existing manifest open during refresh.
        for (let attempt = 0; ; attempt += 1) {
            signal?.throwIfAborted();
            beforeCommit?.();
            try { await fs.rename(temporaryPath, filePath); break; }
            catch (error) {
                if (process.platform !== 'win32' || !['EPERM', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '') || attempt >= 9) throw error;
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        }
    } catch (error) {
        await fs.rm(temporaryPath, { force: true });
        throw error;
    }
};

const toListItem = (session: SessionFileV1, durationMs?: number, speakerCount?: number): SessionListItem => ({
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    sourceKind: session.sourceKind,
    hasTranscript: Boolean(session.transcript?.path),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(speakerCount !== undefined ? { speakerCount } : {}),
});

export class SessionsService {
    private readonly audioPreprocessor = new AudioPreprocessor();
    private readonly derivedGeneration = new Map<string, Promise<void>>();
    private readonly waveformRequests = new Map<string, { sessionId: string; controller: AbortController; result: Promise<SessionWaveformPeaks> }>();
    private waveformsStopped = false;
    private readonly deletingSessions = new Set<string>();
    private readonly transcriptWrites = new Map<string, Promise<void>>();
    private activeSessionId: string | null = null;
    private activeSessionGeneration = 0;

    public getActiveSessionId(): string | null {
        return this.activeSessionId;
    }

    public getActiveSessionGeneration(): number {
        return this.activeSessionGeneration;
    }

    public recognitionFingerprint(transcript: SessionTranscriptV1): string {
        const materialized = materializeRecognitionTranscript(transcript);
        const recognition = materialized.sourceRun ?? materialized.recognitionSegments ?? materialized.segments;

        return createHash('sha256').update(JSON.stringify([materialized.recognitionRevision, recognition])).digest('hex');
    }

    private async withTranscriptWrite<T>(sessionId: string, write: () => Promise<T>): Promise<T> {
        const preceding = this.transcriptWrites.get(sessionId) ?? Promise.resolve();
        let finish!: () => void;
        const current = new Promise<void>((resolve) => { finish = resolve; });

        this.transcriptWrites.set(sessionId, current);
        await preceding;
        try {
            return await write();
        } finally {
            finish();
            if (this.transcriptWrites.get(sessionId) === current) this.transcriptWrites.delete(sessionId);
        }
    }

    constructor(private readonly derivedCacheBudgetBytes = 1024 * 1024 * 1024) {}

    public getSessionsRootDir(): string {
        return path.join(app.getPath('userData'), 'sessions');
    }

    private resolveSessionDir(sessionId: string): string {
        if (!sessionId || typeof sessionId !== 'string') {
            throw new Error('Invalid session id');
        }

        const trimmed = sessionId.trim();

        if (!trimmed || trimmed.startsWith('.') || trimmed === '..' || /[\\/]/.test(trimmed)) {
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

    public async revealSessionFolder(sessionId: string): Promise<boolean> {
        const sessionDir = this.resolveSessionDir(sessionId);
        const result = await shell.openPath(sessionDir);
        if (result) console.error('Failed to open session folder', result);

        return result === '';
    }

    public async deleteSession(sessionId: string): Promise<void> {
        const sessionDir = this.resolveSessionDir(sessionId);
        await this.withTranscriptWrite(sessionId, async () => {
            this.deletingSessions.add(sessionDir);
            try {
                await this.cancelWaveforms(path.basename(sessionDir));
                await fs.rm(sessionDir, { recursive: true, force: true });
            } finally { this.deletingSessions.delete(sessionDir); }
        });
    }

    public stopWaveformsAndWait(): Promise<void> {
        this.waveformsStopped = true;
        return this.cancelWaveforms();
    }

    private async cancelWaveforms(sessionId?: string): Promise<void> {
        const pending = Array.from(this.waveformRequests.values()).filter((request) => !sessionId || request.sessionId === sessionId);
        for (const request of pending) request.controller.abort();
        await Promise.allSettled(pending.map((request) => request.result));
    }

    public async prepareMissingWaveform(sessionId: string, mode: SessionAudioMode): Promise<void> {
        const cachePath = path.join(this.resolveSessionDir(sessionId), waveformFileName(mode));
        try {
            // The player validates existing peaks when it opens; only precompute on a cache miss.
            await fs.access(cachePath);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            await this.getWaveformPeaks(sessionId, mode);
        }
    }

    public getWaveformPeaks(sessionId: string, mode: SessionAudioMode): Promise<SessionWaveformPeaks> {
        return this.requestWaveformPeaks(this.resolveSessionDir(sessionId), mode);
    }

    public prepareRecordedWaveform(sessionId: string): void {
        const sessionDir = this.resolveSessionDir(sessionId);
        void this.requestWaveformPeaks(sessionDir, 'optimized', true).catch((error: unknown) => {
            if (!this.waveformsStopped && !this.deletingSessions.has(sessionDir)) {
                console.warn('Failed to prepare recording waveform', error);
            }
        });
    }

    private requestWaveformPeaks(sessionDir: string, mode: SessionAudioMode, prepareAudio = false): Promise<SessionWaveformPeaks> {
        if (this.waveformsStopped) return Promise.reject(new Error('Waveform preparation has stopped'));
        if (this.deletingSessions.has(sessionDir)) return Promise.reject(new Error('Session is being deleted'));
        const cachePath = path.join(sessionDir, waveformFileName(mode));
        const existing = this.waveformRequests.get(cachePath);
        if (existing) return existing.result;
        const controller = new AbortController();
        const result = this.readWaveform(sessionDir, mode, cachePath, controller.signal, prepareAudio)
            .finally(() => this.waveformRequests.delete(cachePath));
        this.waveformRequests.set(cachePath, { sessionId: path.basename(sessionDir), controller, result });
        return result;
    }

    private async readWaveform(
        sessionDir: string, mode: SessionAudioMode, cachePath: string, signal: AbortSignal, prepareAudio: boolean,
    ): Promise<SessionWaveformPeaks> {
        if (!(await fs.lstat(sessionDir)).isDirectory()) throw new Error('Invalid session directory');
        if (prepareAudio) {
            const sessionFilePath = path.join(sessionDir, SESSION_FILE_NAME);
            const session = await readJsonFile<SessionFileV1>(sessionFilePath);
            await this.ensureSessionWavFile(sessionDir, sessionFilePath, session, signal);
        }
        const original = await this.resolveOwnedFile(sessionDir, SESSION_WAV_RELATIVE_PATH);
        if (prepareAudio) await this.prepareSourceAudio(original, mode, signal);
        const audio = mode === 'original' ? original : await this.resolveOwnedFile(sessionDir, path.relative(sessionDir, (await optimizedTarget(original)).target));
        return loadWaveformPeaks(audio, cachePath, signal);
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

                const safeFile = (relativePath: string | undefined): string | undefined => {
                    if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) return undefined;
                    const resolved = path.resolve(sessionDir, relativePath);
                    if (!resolved.startsWith(`${path.resolve(sessionDir)}${path.sep}`)) return undefined;
                    return resolved;
                };
                let durationMs: number | undefined;
                for (const relativePath of [session.audio?.wavPath, session.audio?.originalPath]) {
                    const audioPath = safeFile(relativePath);
                    const audioDuration = audioPath ? await readWavDurationMs(audioPath) : undefined;
                    if (audioDuration !== undefined) { durationMs = audioDuration; break; }
                }
                if (durationMs === undefined && Array.isArray(session.tracks) && session.tracks.length && session.tracks.every((track) =>
                    track && Number.isFinite(track.startOffsetMs) && track.startOffsetMs >= 0 && Number.isFinite(track.durationMs) && track.durationMs! >= 0)) {
                    durationMs = Math.max(...session.tracks.map((track) => track.startOffsetMs + track.durationMs!));
                }
                let speakerCount: number | undefined;
                const transcriptPath = safeFile(session.transcript?.path);
                if (transcriptPath) {
                    try {
                        const transcript = await readJsonFile<SessionTranscriptV1>(transcriptPath);
                        if (Array.isArray(transcript.speakers?.speakers)) speakerCount = transcript.speakers.speakers.length;
                    } catch { /* Missing or invalid transcripts do not hide the session. */ }
                }
                sessions.push(toListItem(session, durationMs, speakerCount));
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

        const audioMode = resolvedSession.audioMode ?? 'optimized';
        const audioOptimizedWavPath = audioMode === 'optimized' || resolvedSession.audio.optimizedWavPath ?
            await this.prepareSourceAudio(audioWavPath, 'optimized') : undefined;
        const waveformPath = path.join(sessionDir, waveformFileName(audioMode));
        await this.touchDerivedFiles(resolvedSession.id, [
            { kind: 'listening', path: audioWavPath },
            { kind: `waveform-${audioMode}`, path: waveformPath },
            ...(audioOptimizedWavPath ? [{ kind: 'optimized' as const, path: audioOptimizedWavPath }] : []),
        ]);
        await this.enforceDerivedCacheBudget(new Set([audioWavPath, waveformPath, ...(audioOptimizedWavPath ? [audioOptimizedWavPath] : [])]));

        let transcript: SessionTranscriptV1 | undefined;

        if (resolvedSession.transcript?.path) {
            const transcriptPath = path.join(sessionDir, resolvedSession.transcript.path);

            try {
                transcript = await readJsonFile<SessionTranscriptV1>(transcriptPath);
                if (transcript.summary) transcript.summary = getReadableSummary(transcript);
                if (transcript.summaryDraft) transcript.summaryDraft = getReadableSummaryDraft(transcript);
            } catch {
                transcript = undefined;
            }
        }

        return {
            ...toListItem(resolvedSession),
            audioMode,
            audioOriginalPath,
            sourceFileName: resolvedSession.audio.originalFileName,
            sourceMetadata: await this.audioPreprocessor.readSourceMetadata(audioOriginalPath),
            audioWavPath,
            audioOptimizedWavPath,
            transcript,
            transcription: resolvedSession.transcription,
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

        try {
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
        } catch (error: unknown) {
            await fs.rm(sessionDir, { recursive: true, force: true }).catch((cleanupError: unknown) => {
                console.error('Failed to clean up the incomplete imported session', cleanupError);
            });
            throw error;
        }

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
        if (this.activeSessionId !== sessionId) this.activeSessionGeneration += 1;
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

    public async optimizeSessionAudio(sessionId: string, mode: 'original' | 'optimized' = 'optimized'): Promise<SessionDetails> {
        const sessionDir = this.resolveSessionDir(sessionId);
        const sessionFilePath = path.join(sessionDir, SESSION_FILE_NAME);
        const session = await readJsonFile<SessionFileV1>(sessionFilePath);
        if (!session || session.version !== SESSION_VERSION || !['original', 'optimized'].includes(mode)) throw new Error('Invalid audio choice');
        // Generate before persisting the choice. Failed conversion keeps the previous choice.
        if (mode === 'optimized') {
            const wav = await this.ensureSessionWavFile(sessionDir, sessionFilePath, session);
            await this.prepareSourceAudio(wav.wavPath, mode);
        }
        const latest = await readJsonFile<SessionFileV1>(sessionFilePath);
        await writeJsonFile(sessionFilePath, { ...latest, audioMode: mode, updatedAt: Date.now() });
        return this.getSession(sessionId);
    }

    public async prepareSourceAudio(audioPath: string, mode: 'original' | 'optimized', signal?: AbortSignal, microphoneGate = false): Promise<string> {
        signal?.throwIfAborted();
        if (mode === 'original') return audioPath;
        const { target, configuration } = await optimizedTarget(audioPath, microphoneGate);
        await this.runDerivedGeneration(target, async () => {
            try { await fs.access(target); return; } catch { /* Generate a missing cache entry. */ }
            const prepared = await this.audioPreprocessor.convertAudio({ audioPath, ...configuration, signal });
            const temporary = target + '.' + randomUUID() + '.tmp';
            try {
                signal?.throwIfAborted();
                await fs.mkdir(path.dirname(target), { recursive: true });
                await fs.copyFile(prepared.path, temporary);
                signal?.throwIfAborted();
                await fs.rename(temporary, target);
            } finally {
                await fs.rm(temporary, { force: true });
                await prepared.cleanup();
            }
        });
        signal?.throwIfAborted();
        return target;
    }

    public async saveTranscript(
        sessionId: string,
        transcript: SessionTranscriptV1,
        transcription?: SessionTranscriptionInfo,
    ): Promise<void> {
        await this.withTranscriptWrite(sessionId, () => this.writeTranscript(sessionId, transcript, transcription));
    }

    public async readSummaryInput(sessionId: string) {
        const { transcript, session } = await this.readStoredTranscript(sessionId);
        const input = getSummaryInput(transcript);
        if (!input) throw new Error('A complete transcript with speech is required.');
        const saved = getReadableSummary(transcript);
        const setting = transcript.sourceRun?.settings.language ?? session.transcription?.language;
        const languageHint = typeof setting === 'string' ? setting.trim() : '';
        return { ...input, saved, savedSourceMatches: !transcript.summary?.sourceRevision || transcript.summary.sourceRevision === input.sourceRevision,
            draft: getReadableSummaryDraft(transcript), ...(languageHint && languageHint.toLowerCase() !== 'auto' ? { languageHint } : {}) };
    }

    public async saveSummary(sessionId: string, summary: SessionSummary, signal: AbortSignal, activeGeneration?: number): Promise<SessionSummary> {
        return this.withTranscriptWrite(sessionId, async () => {
            signal.throwIfAborted();
            const { transcript, transcriptPath } = await this.readStoredTranscript(sessionId);
            const input = getSummaryInput(transcript);
            if (input?.inputHash !== summary.inputHash
                || (summary.sourceRevision !== undefined && summary.sourceRevision !== input?.sourceRevision)) {
                throw new Error('The transcript changed during summarization.');
            }
            // This rename commits the summary. Cancellation after it must return the saved result.
            this.assertSummaryOwner(sessionId, activeGeneration);
            const readable = getReadableSummary({ ...transcript, summary })!;
            await writeJsonFile(transcriptPath, { ...transcript, summary: readable,
                summaryDraft: summary.brief ? undefined : getReadableSummaryDraft(transcript) }, signal,
                () => this.assertSummaryOwner(sessionId, activeGeneration));
            return readable;
        });
    }

    public async saveSummaryDraft(
        sessionId: string, draft: SessionSummaryDraft, signal: AbortSignal, activeGeneration?: number,
    ): Promise<SessionSummaryDraft> {
        return this.withTranscriptWrite(sessionId, async () => {
            signal.throwIfAborted();
            const { transcript, transcriptPath } = await this.readStoredTranscript(sessionId);
            const input = getSummaryInput(transcript);
            if (!input || draft.inputHash !== input.inputHash || draft.sourceRevision !== input.sourceRevision) {
                throw new Error('The transcript changed during summarization.');
            }
            const readable = getReadableSummaryDraft({ ...transcript, summaryDraft: draft });
            if (!readable) throw new Error('SUMMARY_DRAFT_INCOMPATIBLE');
            this.assertSummaryOwner(sessionId, activeGeneration);
            await writeJsonFile(transcriptPath, { ...transcript, summaryDraft: readable }, signal,
                () => this.assertSummaryOwner(sessionId, activeGeneration));
            return readable;
        });
    }

    private assertSummaryOwner(sessionId: string, activeGeneration?: number): void {
        if (activeGeneration !== undefined && (this.activeSessionGeneration !== activeGeneration
            || (this.activeSessionId !== null && this.activeSessionId !== sessionId))) {
            throw new DOMException('The active session changed.', 'AbortError');
        }
    }

    public async replaceTranscriptIfCurrent(
        sessionId: string,
        expectedFingerprint: string,
        replacement: SessionTranscriptV1,
        signal?: AbortSignal,
        expectedActiveGeneration?: number,
    ): Promise<boolean> {
        return this.withTranscriptWrite(sessionId, async () => {
            signal?.throwIfAborted();
            const { transcript: current } = await this.readStoredTranscript(sessionId);
            if (this.recognitionFingerprint(current) !== expectedFingerprint) return false;
            if (expectedActiveGeneration !== undefined && this.activeSessionGeneration !== expectedActiveGeneration) return false;
            if (this.activeSessionId !== null && this.activeSessionId !== sessionId) return false;
            signal?.throwIfAborted();
            await this.writeTranscript(sessionId,
                deriveSpeakerTranscript({ ...current, speakers: replacement.speakers }), undefined, signal);
            return true;
        });
    }

    public async updateTranscript(
        sessionId: string,
        update: (transcript: SessionTranscriptV1) => SessionTranscriptV1,
    ): Promise<SessionDetails> {
        await this.withTranscriptWrite(sessionId, async () => {
            const { transcript: current } = await this.readStoredTranscript(sessionId);
            await this.writeTranscript(sessionId, update(current));
        });
        return this.getSession(sessionId);
    }

    private async readStoredTranscript(sessionId: string): Promise<{
        session: SessionFileV1; transcript: SessionTranscriptV1; transcriptPath: string;
    }> {
        const sessionDir = this.resolveSessionDir(sessionId);
        const session = await readJsonFile<SessionFileV1>(path.join(sessionDir, SESSION_FILE_NAME));
        if (!session?.transcript?.path) throw new Error('Session has no transcript');
        const transcriptPath = await this.resolveOwnedFile(sessionDir, session.transcript.path);
        const transcript = await readJsonFile<SessionTranscriptV1>(transcriptPath);
        if (transcript?.version !== 1) throw new Error('Invalid session transcript');
        return { session, transcript, transcriptPath };
    }

    private async writeTranscript(
        sessionId: string,
        transcript: SessionTranscriptV1,
        transcription?: SessionTranscriptionInfo,
        signal?: AbortSignal,
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
        if (transcription !== undefined) session.transcription = transcription;

        const transcriptPath = path.join(sessionDir, TRANSCRIPT_FILE_RELATIVE_PATH);

        await writeJsonFile(transcriptPath, { ...transcript, summary: getReadableSummary(transcript), summaryDraft: getReadableSummaryDraft(transcript) }, signal);
        await writeJsonFile(sessionFilePath, session);
    }

    public async setTranscriptDuplicateFilter(sessionId: string, enabled: boolean): Promise<SessionDetails> {
        return this.updateTranscript(sessionId, (current) => {
            const sourceRun = current.sourceRun;
            if (!sourceRun) throw new Error('Session has no source-aware transcript');
            if (!sourceRun.sources.some((source) => source.status === 'completed')) {
                throw new Error('Transcript has no completed source results');
            }
            const filtered = deriveSourceTranscript(structuredClone(sourceRun), enabled);
            return deriveSpeakerTranscript({ ...current, presentation: filtered.presentation });
        });
    }

    private async ensureSessionWavFile(
        sessionDir: string,
        sessionFilePath: string,
        session: SessionFileV1,
        signal?: AbortSignal,
    ): Promise<{ wavPath: string; session: SessionFileV1 }> {
        signal?.throwIfAborted();
        const explicitWavRelativePath = session.audio.wavPath?.trim() || null;
        const fallbackWavRelativePath = path.extname(session.audio.originalPath).toLowerCase() === '.wav' ?
            session.audio.originalPath :
            null;
        const existingRelativePath = explicitWavRelativePath ?? fallbackWavRelativePath;

        if (existingRelativePath === SESSION_WAV_RELATIVE_PATH) {
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
                })), signal) : await this.audioPreprocessor.convertAudio({ audioPath: originalAbsolutePath, ...SESSION_WAV_CONVERT_OPTIONS, signal });
            const temporary = targetWavPath + '.' + randomUUID() + '.tmp';
            try {
                signal?.throwIfAborted();
                await fs.mkdir(path.dirname(targetWavPath), { recursive: true });
                await fs.copyFile(tmpWavPath, temporary);
                signal?.throwIfAborted();
                await fs.rename(temporary, targetWavPath);
            } finally {
                await Promise.all([fs.rm(temporary, { force: true }), cleanup()]);
            }
        });
        signal?.throwIfAborted();
        if (explicitWavRelativePath === SESSION_WAV_RELATIVE_PATH) return { wavPath: targetWavPath, session };

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

    private async runDerivedGeneration(targetPath: string, generate: () => Promise<void>): Promise<void> {
        const existing = this.derivedGeneration.get(targetPath);
        if (existing) return existing;
        const operation = generate().finally(() => this.derivedGeneration.delete(targetPath));
        this.derivedGeneration.set(targetPath, operation);
        return operation;
    }

    private async touchDerivedFiles(sessionId: string, files: Array<{ kind: DerivedCacheKind; path: string }>): Promise<void> {
        const indexPath = path.join(this.getSessionsRootDir(), DERIVED_CACHE_INDEX_FILE);
        let index: DerivedCacheIndex = {};
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
        const index = await this.rebuildDerivedCacheIndex(indexPath);
        const candidates: Array<{ key: string; path: string; size: number; lastAccessedAt: number }> = [];
        let total = 0;
        for (const [key, entry] of Object.entries(index)) {
            try {
                const sessionDir = this.resolveSessionDir(entry.sessionId);
                const target = await this.resolveOwnedFile(sessionDir, entry.relativePath);
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
            const readingWaveform = Array.from(this.waveformRequests.values()).some((request) => request.sessionId === indexed?.sessionId);
            if (excluded.has(candidate.path) || indexed?.sessionId === this.activeSessionId || this.derivedGeneration.has(candidate.path)
                || readingWaveform) continue;
            try {
                await fs.rm(candidate.path, { force: true });
            } catch (error) {
                // A media reader can keep a previous session's WAV locked until after the switch.
                const code = (error as NodeJS.ErrnoException).code;
                if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') continue;
                throw error;
            }
            total -= candidate.size; delete index[candidate.key];
        }
        await writeJsonFile(indexPath, index);
    }

    private async rebuildDerivedCacheIndex(indexPath: string): Promise<DerivedCacheIndex> {
        let previous: DerivedCacheIndex = {};
        try { previous = await readJsonFile<DerivedCacheIndex>(indexPath); } catch { /* Rebuild from session manifests. */ }

        let entries: Array<import('fs').Dirent> = [];
        try { entries = await fs.readdir(this.getSessionsRootDir(), { withFileTypes: true }); } catch { return {}; }

        const rebuilt: DerivedCacheIndex = {};
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
            const sessionDir = this.resolveSessionDir(entry.name);
            let session: SessionFileV1;
            try {
                session = await readJsonFile<SessionFileV1>(path.join(sessionDir, SESSION_FILE_NAME));
                if (session.version !== SESSION_VERSION) continue;
                if (!session.audio || typeof session.audio.originalPath !== 'string'
                    || (session.audio.wavPath !== undefined && typeof session.audio.wavPath !== 'string')
                    || (session.audio.optimizedWavPath !== undefined && typeof session.audio.optimizedWavPath !== 'string')) continue;
            } catch {
                continue;
            }

            const files: Array<{ kind: DerivedCacheKind; relativePath: string }> = [
                { kind: 'waveform-original', relativePath: waveformFileName('original') },
                { kind: 'waveform-optimized', relativePath: waveformFileName('optimized') },
            ];
            // Keep fingerprinted source caches discoverable after restart without touching originals.
            for (const parent of ['audio', ...(session.tracks ?? []).map((track) => path.dirname(track.filePath))]) {
                const derived = path.join(sessionDir, parent, 'derived');
                let caches: string[] = [];
                try { caches = await fs.readdir(derived); } catch { /* No generated cache yet. */ }
                for (const name of caches) {
                    if (/^[a-f0-9]{20}\.wav$/.test(name)) files.push({ kind: 'optimized', relativePath: path.relative(sessionDir, path.join(derived, name)) });
                }
            }
            if (session.audio.wavPath) {
                const isListeningCache = Boolean(session.tracks?.length)
                    || path.resolve(sessionDir, session.audio.wavPath) !== path.resolve(sessionDir, session.audio.originalPath);
                if (isListeningCache) files.push({ kind: 'listening', relativePath: session.audio.wavPath });
            }
            if (session.audio.optimizedWavPath) {
                files.push({ kind: 'optimized', relativePath: session.audio.optimizedWavPath });
            }

            for (const file of files) {
                try {
                    const target = await this.resolveOwnedFile(sessionDir, file.relativePath);
                    const stat = await fs.stat(target);
                    const key = `${entry.name}:${file.kind}`;
                    rebuilt[key] = {
                        sessionId: entry.name,
                        kind: file.kind,
                        relativePath: file.relativePath,
                        lastAccessedAt: previous[key]?.lastAccessedAt ?? stat.mtimeMs,
                    };
                } catch { /* Missing derived files are generated when requested. */ }
            }
        }
        return rebuilt;
    }

    private async resolveOwnedFile(sessionDir: string, relativePath: string): Promise<string> {
        const target = this.resolveTrackPath(sessionDir, relativePath);
        const stat = await fs.lstat(target);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid session file');
        const canonicalSessionDir = await fs.realpath(sessionDir);
        const canonicalTarget = await fs.realpath(target);
        const relative = path.relative(canonicalSessionDir, canonicalTarget);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
            throw new Error('Session file is outside managed storage');
        }
        return target;
    }
}
