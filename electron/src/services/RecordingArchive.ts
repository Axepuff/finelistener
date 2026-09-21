import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { app } from 'electron';
import type { WavFormat } from './AudioPreprocessor';
import { AudioPreprocessor } from './AudioPreprocessor';
import type { RecordingResult } from './RecordingService';
import type { RecordingSourceKind, RecordingSources } from './capture/CaptureAdapter';
import type { FinalizeRecordingResult, RecoverableRecording, RecordingSourceWarning, RecoveryState } from '../types/recordingArchive';
import type { SessionFileV1, SessionSourceTrack } from '../types/sessions';
import { SessionsService } from './SessionsService';

const MANIFEST_FILE = 'recovery.json';
const AUDIO_DIR = 'audio';
const MIX_FILE = path.join(AUDIO_DIR, 'source.wav');
const SESSION_FILE = 'session.json';
const RECOVERY_VERSION = 1 as const;
const SESSION_VERSION = 1 as const;
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const DEFAULT_RECOVERY_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;
export const DEFAULT_RECOVERY_WARNING_AGE_MS = 14 * 24 * 60 * 60 * 1000;

interface RecoveryManifestV1 {
    version: 1;
    recordingId: string;
    createdAt: number;
    state: RecoveryState;
    sources: RecordingSourceKind[];
    format: WavFormat;
    durationMs?: number;
    bytesWritten?: number;
    sessionId?: string;
    sourceWarnings: RecordingSourceWarning[];
    tracks?: Array<{ source: RecordingSourceKind; startOffsetMs: number; durationMs?: number }>;
}

interface PreparedRecording {
    recordingId: string;
    outputPath: string;
    startedAt: number;
}

interface RecordingArchiveConfig {
    rootDir?: string;
    sessionsService?: SessionsService;
    audioPreprocessor?: AudioPreprocessor;
    recoveryQuotaBytes?: number;
}

const sourceFileName = (source: RecordingSourceKind): string => `${source}.wav`;

const atomicWriteJson = async (filePath: string, value: unknown): Promise<void> => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
    await fs.rename(temporaryPath, filePath);
};

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

export class RecordingArchive {
    private readonly rootDir: string;
    private readonly sessionsService: SessionsService;
    private readonly audioPreprocessor: AudioPreprocessor;
    private readonly recoveryQuotaBytes: number;
    private readonly operations = new Map<string, Promise<FinalizeRecordingResult>>();

    constructor(config: RecordingArchiveConfig = {}) {
        this.rootDir = config.rootDir ?? path.join(app.getPath('userData'), 'recordings');
        this.sessionsService = config.sessionsService ?? new SessionsService();
        this.audioPreprocessor = config.audioPreprocessor ?? new AudioPreprocessor();
        this.recoveryQuotaBytes = config.recoveryQuotaBytes ?? DEFAULT_RECOVERY_QUOTA_BYTES;
    }

    public async prepareCapture(sources: RecordingSources | undefined, format: WavFormat): Promise<PreparedRecording> {
        const usage = await this.getRecoveryUsage();
        if (usage >= this.recoveryQuotaBytes) {
            throw new Error('Recording storage is full. Recover or delete an unfinished recording before starting a new one.');
        }
        const recordingId = randomUUID();
        const createdAt = Date.now();
        const enabledSources = this.resolveSources(sources);
        const recordingDir = this.pendingDir(recordingId);
        await fs.mkdir(path.join(recordingDir, AUDIO_DIR), { recursive: true });
        const manifest: RecoveryManifestV1 = {
            version: RECOVERY_VERSION,
            recordingId,
            createdAt,
            state: 'capturing',
            sources: enabledSources,
            format,
            sourceWarnings: [],
        };
        await atomicWriteJson(path.join(recordingDir, MANIFEST_FILE), manifest);
        const primarySource = enabledSources.includes('system') ? 'system' : 'microphone';
        return { recordingId, startedAt: createdAt, outputPath: path.join(recordingDir, AUDIO_DIR, sourceFileName(primarySource)) };
    }

    public async registerCaptureResult(recordingId: string, result: RecordingResult): Promise<void> {
        const location = await this.findOwnedRecording(recordingId);
        const manifest = await this.readManifest(location);
        const failures = new Map(result.sourceFailures?.map((failure) => [failure.source, failure.message]) ?? []);
        const submittedTracks = result.tracks?.length ? result.tracks : [{
            source: manifest.sources[0], filePath: result.filePath, durationMs: result.durationMs,
        }];
        const observedTracks: NonNullable<RecoveryManifestV1['tracks']> = [];
        for (const track of submittedTracks) {
            if (!manifest.sources.includes(track.source)) throw new Error('Capture returned an unexpected recording source');
            const exists = await this.assertOwnedTrack(location, track.filePath, track.source);
            if (!exists) {
                failures.set(track.source, 'Recording source did not produce an audio file.');
                continue;
            }
            observedTracks.push({
                source: track.source,
                startOffsetMs: Number.isFinite(track.startOffsetMs) && (track.startOffsetMs ?? 0) >= 0 ? track.startOffsetMs ?? 0 : 0,
                durationMs: Number.isFinite(track.durationMs) && (track.durationMs ?? 0) >= 0 ? track.durationMs : undefined,
            });
            if (track.failure) failures.set(track.source, track.failure);
        }
        manifest.durationMs = result.durationMs;
        manifest.bytesWritten = result.bytesWritten;
        manifest.sourceWarnings = Array.from(failures, ([source, message]) => ({ source, message }));
        manifest.tracks = observedTracks;
        manifest.state = 'ready';
        await atomicWriteJson(path.join(location, MANIFEST_FILE), manifest);
    }

    public finalize(recordingId: string): Promise<FinalizeRecordingResult> {
        this.assertId(recordingId);
        const existing = this.operations.get(recordingId);
        if (existing) return existing;
        const operation = this.finalizeInternal(recordingId).finally(() => this.operations.delete(recordingId));
        this.operations.set(recordingId, operation);
        return operation;
    }

    public recover(recordingId: string): Promise<FinalizeRecordingResult> {
        return this.finalize(recordingId);
    }

    public async listRecoverable(): Promise<RecoverableRecording[]> {
        const items: RecoverableRecording[] = [];
        await this.collectKnownRecordings(this.pendingRoot(), items);
        await this.collectKnownRecordings(this.stagingRoot(), items);
        await this.collectLegacyEntries(items);
        return items.sort((a, b) => a.createdAt - b.createdAt);
    }

    public async discard(recordingId: string): Promise<void> {
        if (recordingId.startsWith('unknown-pending:') || recordingId.startsWith('unknown-staging:')) {
            const isPending = recordingId.startsWith('unknown-pending:');
            const prefix = isPending ? 'unknown-pending:' : 'unknown-staging:';
            const entryName = recordingId.slice(prefix.length);
            if (!entryName || entryName === '.' || entryName === '..' || /[\\/]/.test(entryName)) throw new Error('Invalid recording id');
            const root = isPending ? this.pendingRoot() : this.stagingRoot();
            const target = path.join(root, entryName);
            await this.assertOwnedDirectory(target);
            await fs.rm(target, { recursive: true, force: true });
            return;
        }
        if (recordingId.startsWith('legacy:')) {
            const entryName = recordingId.slice('legacy:'.length);
            if (!entryName || entryName === '.' || entryName === '..' || /[\\/]/.test(entryName)) throw new Error('Invalid recording id');
            const target = path.join(this.rootDir, entryName);
            const relative = path.relative(path.resolve(this.rootDir), path.resolve(target));
            if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid recording path');
            await fs.rm(target, { recursive: true, force: true });
            return;
        }
        this.assertId(recordingId);
        if (this.operations.has(recordingId)) throw new Error('Recording recovery is already in progress');
        const candidates = [this.pendingDir(recordingId), path.join(this.stagingRoot(), recordingId)];
        const location = (await Promise.all(candidates.map(async (candidate) => await this.exists(candidate) ? candidate : null))).find(Boolean);
        if (!location) throw new Error('Recording recovery item was not found');
        await this.assertOwnedDirectory(location);
        await fs.rm(location, { recursive: true, force: true });
    }

    private async finalizeInternal(recordingId: string): Promise<FinalizeRecordingResult> {
        let location: string;
        try {
            location = await this.findOwnedRecording(recordingId);
        } catch (error) {
            const published = await this.findPublishedSession(recordingId);
            if (published) {
                return {
                    recordingId,
                    sessionId: published.id,
                    session: await this.sessionsService.getSession(published.id),
                    sourceWarnings: published.sourceWarnings ?? [],
                };
            }
            throw error;
        }
        const manifest = await this.readManifest(location);
        if (manifest.sessionId) {
            const publishedDir = path.join(this.sessionsRoot(), manifest.sessionId);
            if (await this.exists(path.join(publishedDir, SESSION_FILE))) return this.resultFromPublished(manifest, publishedDir);
        }
        const validTracks: SessionSourceTrack[] = [];
        const warnings = new Map(manifest.sourceWarnings.map((warning) => [warning.source, warning.message]));
        for (const source of manifest.sources) {
            const filePath = path.join(location, AUDIO_DIR, sourceFileName(source));
            try {
                const durationMs = await this.validateWav(filePath);
                const observed = manifest.tracks?.find((track) => track.source === source);
                validTracks.push({
                    source,
                    filePath: path.join(AUDIO_DIR, sourceFileName(source)),
                    startOffsetMs: observed?.startOffsetMs ?? 0,
                    durationMs: observed?.durationMs ?? durationMs,
                });
            } catch (error) {
                warnings.set(source, `Recording source could not be recovered: ${errorMessage(error)}`);
            }
        }
        manifest.sourceWarnings = Array.from(warnings, ([source, message]) => ({ source, message }));
        if (validTracks.length === 0) {
            manifest.state = 'recoverable';
            await atomicWriteJson(path.join(location, MANIFEST_FILE), manifest);
            throw new Error('No recoverable audio was found in this recording.');
        }
        const sessionId = manifest.sessionId ?? randomUUID();
        manifest.sessionId = sessionId;
        manifest.state = 'committing';
        await atomicWriteJson(path.join(location, MANIFEST_FILE), manifest);
        const stagingDir = path.join(this.stagingRoot(), sessionId);
        if (path.resolve(location) !== path.resolve(stagingDir)) {
            await fs.mkdir(this.stagingRoot(), { recursive: true });
            await fs.rename(location, stagingDir);
            location = stagingDir;
        }
        let published = false;
        try {
            const mixed = await this.audioPreprocessor.mixSources(validTracks.map((track) => ({
                filePath: path.join(location, track.filePath), startOffsetMs: track.startOffsetMs,
            })));
            try {
                await fs.copyFile(mixed.path, path.join(location, MIX_FILE));
            } finally {
                await mixed.cleanup().catch(() => void 0);
            }
            const now = Date.now();
            const session: SessionFileV1 = {
                version: SESSION_VERSION,
                id: sessionId,
                recordingId,
                title: `recording-${this.formatDate(manifest.createdAt)}.wav`,
                createdAt: manifest.createdAt,
                updatedAt: now,
                sourceKind: 'recorded',
                tracks: validTracks,
                sourceWarnings: manifest.sourceWarnings,
                audio: { originalFileName: 'recording.wav', originalPath: MIX_FILE, wavPath: MIX_FILE },
            };
            await atomicWriteJson(path.join(location, SESSION_FILE), session);
            const publishedDir = path.join(this.sessionsRoot(), sessionId);
            await fs.rename(location, publishedDir);
            published = true;
            await fs.rm(path.join(publishedDir, MANIFEST_FILE), { force: true }).catch((error) => {
                console.warn('Failed to remove published recording recovery manifest', error);
            });
            return { recordingId, sessionId, session: await this.sessionsService.getSession(sessionId), sourceWarnings: manifest.sourceWarnings };
        } catch (error) {
            if (published) throw error;
            manifest.state = 'recoverable';
            await atomicWriteJson(path.join(location, MANIFEST_FILE), manifest).catch((writeError) => {
                console.error('Failed to update recording recovery manifest', writeError);
            });
            throw error;
        }
    }

    private async resultFromPublished(manifest: RecoveryManifestV1, _publishedDir: string): Promise<FinalizeRecordingResult> {
        const sessionId = manifest.sessionId!;
        return { recordingId: manifest.recordingId, sessionId, session: await this.sessionsService.getSession(sessionId), sourceWarnings: manifest.sourceWarnings };
    }

    private async findPublishedSession(recordingId: string): Promise<SessionFileV1 | null> {
        let entries: import('fs').Dirent[] = [];
        try { entries = await fs.readdir(this.sessionsRoot(), { withFileTypes: true }); } catch { return null; }
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name === '.staging') continue;
            const sessionPath = path.join(this.sessionsRoot(), entry.name, SESSION_FILE);
            try {
                const session = JSON.parse(await fs.readFile(sessionPath, 'utf8')) as SessionFileV1 & { recordingId?: string };
                if (session.recordingId === recordingId) return session;
            } catch { /* Ignore invalid session entries. */ }
        }
        return null;
    }

    private async collectKnownRecordings(root: string, items: RecoverableRecording[]): Promise<void> {
        let entries: import('fs').Dirent[] = [];
        try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const location = path.join(root, entry.name);
            try {
                const manifest = await this.readManifest(location);
                if (manifest.state === 'capturing') {
                    manifest.state = 'recoverable';
                    await atomicWriteJson(path.join(location, MANIFEST_FILE), manifest);
                }
                items.push({
                    recordingId: manifest.recordingId, createdAt: manifest.createdAt,
                    ageMs: Math.max(0, Date.now() - manifest.createdAt), sizeBytes: await this.directorySize(location),
                    state: manifest.state, sources: manifest.sources, sourceWarnings: manifest.sourceWarnings,
                    canRecover: true,
                });
            } catch {
                const stat = await fs.stat(location).catch(() => null);
                const prefix = path.resolve(root) === path.resolve(this.pendingRoot()) ? 'unknown-pending:' : 'unknown-staging:';
                items.push({ recordingId: `${prefix}${entry.name}`, createdAt: stat?.birthtimeMs ?? Date.now(), ageMs: stat ? Date.now() - stat.birthtimeMs : 0,
                    sizeBytes: await this.directorySize(location), state: 'unknown', sources: [], sourceWarnings: [], canRecover: false });
            }
        }
    }

    private async collectLegacyEntries(items: RecoverableRecording[]): Promise<void> {
        let entries: import('fs').Dirent[] = [];
        try { entries = await fs.readdir(this.rootDir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            if (entry.name === 'pending') continue;
            const target = path.join(this.rootDir, entry.name);
            const stat = await fs.stat(target).catch(() => null);
            if (!stat) continue;
            items.push({ recordingId: `legacy:${entry.name}`, createdAt: stat.birthtimeMs, ageMs: Date.now() - stat.birthtimeMs,
                sizeBytes: stat.isDirectory() ? await this.directorySize(target) : stat.size, state: 'unknown', sources: [], sourceWarnings: [], canRecover: false });
        }
    }

    private async getRecoveryUsage(): Promise<number> {
        const items = await this.listRecoverable();
        return items.reduce((sum, item) => sum + item.sizeBytes, 0);
    }

    private async validateWav(filePath: string): Promise<number> {
        const stat = await fs.lstat(filePath);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Track is not a regular file');
        const file = await fs.open(filePath, 'r');
        try {
            const header = Buffer.alloc(44);
            const { bytesRead } = await file.read(header, 0, header.length, 0);
            if (bytesRead < 44 || header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Invalid WAV header');
            const byteRate = header.readUInt32LE(28);
            const dataMarker = header.toString('ascii', 36, 40);
            const dataSize = header.readUInt32LE(40);
            if (dataMarker !== 'data' || byteRate <= 0 || dataSize <= 0 || stat.size < 44 + dataSize) throw new Error('WAV has no complete audio data');
            return Math.round(dataSize / byteRate * 1000);
        } finally { await file.close(); }
    }

    private async assertOwnedTrack(location: string, submittedPath: string, source: RecordingSourceKind): Promise<boolean> {
        const expected = path.join(location, AUDIO_DIR, sourceFileName(source));
        if (path.resolve(submittedPath) !== path.resolve(expected)) throw new Error('Capture returned a path outside its recording directory');
        const canonicalRoot = await fs.realpath(location);
        const canonicalParent = await fs.realpath(path.dirname(submittedPath));
        const relativeParent = path.relative(canonicalRoot, canonicalParent);
        if (!relativeParent || relativeParent.startsWith('..') || path.isAbsolute(relativeParent)) throw new Error('Invalid recording track path');
        let stat: import('fs').Stats;
        try { stat = await fs.lstat(submittedPath); }
        catch (error) {
            if (error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ENOENT') return false;
            throw error;
        }
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid recording track file');
        const canonicalFile = await fs.realpath(submittedPath);
        const relative = path.relative(canonicalRoot, canonicalFile);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid recording track path');
        return true;
    }

    private async assertOwnedDirectory(location: string): Promise<void> {
        const allowedRoots = [this.pendingRoot(), this.stagingRoot()].map((root) => path.resolve(root));
        const resolved = path.resolve(location);
        if (!allowedRoots.some((root) => { const relative = path.relative(root, resolved); return relative && !relative.startsWith('..') && !path.isAbsolute(relative); })) {
            throw new Error('Invalid recording directory');
        }
        const stat = await fs.lstat(location);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid recording directory');
    }

    private async findOwnedRecording(recordingId: string): Promise<string> {
        this.assertId(recordingId);
        for (const candidate of [this.pendingDir(recordingId), path.join(this.stagingRoot(), recordingId)]) {
            if (await this.exists(path.join(candidate, MANIFEST_FILE))) { await this.assertOwnedDirectory(candidate); return candidate; }
        }
        let stagingEntries: import('fs').Dirent[] = [];
        try { stagingEntries = await fs.readdir(this.stagingRoot(), { withFileTypes: true }); } catch { /* no staging */ }
        for (const entry of stagingEntries) {
            if (!entry.isDirectory()) continue;
            const candidate = path.join(this.stagingRoot(), entry.name);
            try { if ((await this.readManifest(candidate)).recordingId === recordingId) return candidate; } catch { /* ignore */ }
        }
        throw new Error('Recording recovery item was not found');
    }

    private async readManifest(location: string): Promise<RecoveryManifestV1> {
        const value = JSON.parse(await fs.readFile(path.join(location, MANIFEST_FILE), 'utf8')) as Partial<RecoveryManifestV1>;
        if (value.version !== 1 || typeof value.recordingId !== 'string' || !ID_PATTERN.test(value.recordingId)
            || typeof value.createdAt !== 'number' || !Array.isArray(value.sources) || !value.sources.every((source) => source === 'system' || source === 'microphone')
            || !['capturing', 'ready', 'recoverable', 'committing'].includes(value.state ?? '')) throw new Error('Invalid recovery manifest');
        return { ...value, sourceWarnings: Array.isArray(value.sourceWarnings) ? value.sourceWarnings : [] } as RecoveryManifestV1;
    }

    private resolveSources(sources: RecordingSources | undefined): RecordingSourceKind[] {
        if (!sources) return ['system'];
        const enabled: RecordingSourceKind[] = [];
        if (typeof sources.system === 'string') enabled.push('system');
        if (typeof sources.microphone === 'string') enabled.push('microphone');
        if (!enabled.length) throw new Error('Select at least one recording source.');
        return enabled;
    }

    private assertId(id: string): void { if (!ID_PATTERN.test(id)) throw new Error('Invalid recording id'); }
    private pendingRoot(): string { return path.join(this.rootDir, 'pending'); }
    private pendingDir(id: string): string { return path.join(this.pendingRoot(), id); }
    private sessionsRoot(): string { return this.sessionsService.getSessionsRootDir(); }
    private stagingRoot(): string { return path.join(this.sessionsRoot(), '.staging'); }
    private async exists(target: string): Promise<boolean> { try { await fs.access(target); return true; } catch { return false; } }
    private async directorySize(root: string): Promise<number> {
        let total = 0; let entries: import('fs').Dirent[] = [];
        try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { return 0; }
        for (const entry of entries) { const target = path.join(root, entry.name); if (entry.isDirectory()) total += await this.directorySize(target); else if (entry.isFile()) total += (await fs.stat(target)).size; }
        return total;
    }
    private formatDate(timestamp: number): string {
        const date = new Date(timestamp); const part = (value: number) => String(value).padStart(2, '0');
        return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())} ${part(date.getHours())}-${part(date.getMinutes())}-${part(date.getSeconds())}`;
    }
}
