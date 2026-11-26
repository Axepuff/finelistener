import { createHash, randomUUID } from 'crypto';
import fs, { type FileHandle } from 'fs/promises';
import path from 'path';
import type { SessionWaveformPeaks } from '../types/sessions';

const MAX_PEAKS = 65_536;
const CHECKSUM_BYTES = 32;

const readExactly = async (file: FileHandle, buffer: Buffer, position: number): Promise<void> => {
    let offset = 0;
    while (offset < buffer.length) {
        const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, position + offset);
        if (!bytesRead) throw new Error('Truncated WAV data');
        offset += bytesRead;
    }
};

const readWavInfo = async (file: FileHandle) => {
    const header = Buffer.alloc(16);
    await readExactly(file, header.subarray(0, 12), 0);
    if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Invalid WAV header');
    const fileSize = (await file.stat()).size;
    let format: { monoPcm16: boolean; byteRate: number } | undefined;
    for (let offset = 12; offset + 8 <= fileSize;) {
        await readExactly(file, header.subarray(0, 8), offset);
        const kind = header.toString('ascii', 0, 4);
        const size = header.readUInt32LE(4);
        const dataOffset = offset + 8;
        if (dataOffset + size > fileSize) throw new Error('Invalid WAV chunk size');
        if (kind === 'fmt ' && size >= 16) {
            await readExactly(file, header, dataOffset);
            const byteRate = header.readUInt32LE(8);
            format = {
                byteRate,
                monoPcm16: header.readUInt16LE(0) === 1 && header.readUInt16LE(2) === 1 && header.readUInt16LE(12) === 2
                    && header.readUInt16LE(14) === 16 && byteRate === header.readUInt32LE(4) * 2,
            };
        }
        if (kind === 'data' && format?.byteRate) return { ...format, offset: dataOffset, size, duration: size / format.byteRate };
        offset = dataOffset + size + (size & 1);
    }
    throw new Error('Missing WAV data');
};

export const readWavDurationMs = async (filePath: string): Promise<number | undefined> => {
    let file;
    try {
        file = await fs.open(filePath, 'r');
        return Math.round((await readWavInfo(file)).duration * 1000);
    } catch { return undefined; } finally { await file?.close(); }
};

const buildPeaks = async (file: FileHandle, signal: AbortSignal): Promise<SessionWaveformPeaks> => {
    const { monoPcm16, offset, size, duration } = await readWavInfo(file);
    if (!monoPcm16 || !size || size % 2 !== 0) throw new Error('Expected mono PCM16 listening audio');
    const samples = size / 2;
    // Keep short clips detailed and bound the whole-recording overview on long sessions.
    const count = Math.min(samples, MAX_PEAKS, Math.max(1024, Math.ceil(duration * 50)));
    const peaks = new Float32Array(count);
    const block = Buffer.allocUnsafe(Math.min(size, 256 * 1024));
    let peakIndex = 0;
    let nextBoundary = Math.floor(samples / count);
    let maximum = 0;
    for (let consumed = 0; consumed < size; consumed += block.length) {
        signal.throwIfAborted();
        const chunk = block.subarray(0, Math.min(block.length, size - consumed));
        await readExactly(file, chunk, offset + consumed);
        for (let byte = 0, sample = consumed / 2; byte < chunk.length; byte += 2) {
            maximum = Math.max(maximum, Math.abs(chunk.readInt16LE(byte)));
            if (++sample === nextBoundary) {
                peaks[peakIndex++] = maximum / 32768;
                nextBoundary = Math.floor((peakIndex + 1) * samples / count);
                maximum = 0;
            }
        }
    }
    return { peaks, duration };
};

const checksum = (source: string, payload: Buffer): Buffer => createHash('sha256').update(source).update(payload).digest();

const readCached = async (cachePath: string, source: string): Promise<SessionWaveformPeaks | undefined> => {
    try {
        const stat = await fs.lstat(cachePath);
        const length = stat.size - CHECKSUM_BYTES - 8;
        if (!stat.isFile() || length < 2 || length > MAX_PEAKS * 2 || length % 2 !== 0) return undefined;
        const data = await fs.readFile(cachePath);
        const payload = data.subarray(CHECKSUM_BYTES);
        if (data.length !== stat.size || !checksum(source, payload).equals(data.subarray(0, CHECKSUM_BYTES))) return undefined;
        const peaks = new Float32Array(length / 2);
        for (let i = 0; i < peaks.length; i++) peaks[i] = payload.readUInt16LE(8 + i * 2) / 32768;
        return { duration: payload.readDoubleLE(0), peaks };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Failed to read waveform cache', error);
        return undefined;
    }
};

export const loadWaveformPeaks = async (audioPath: string, cachePath: string, signal: AbortSignal): Promise<SessionWaveformPeaks> => {
    const audio = await fs.open(audioPath, 'r');
    try {
        const stat = await audio.stat();
        const source = JSON.stringify([path.basename(audioPath), stat.size, stat.mtimeMs, stat.ctimeMs]);
        signal.throwIfAborted();
        const cached = await readCached(cachePath, source);
        signal.throwIfAborted();
        if (cached) return cached;
        const result = await buildPeaks(audio, signal);
        signal.throwIfAborted();
        const current = await fs.stat(audioPath);
        if (current.size !== stat.size || current.mtimeMs !== stat.mtimeMs || current.ctimeMs !== stat.ctimeMs) {
            throw new Error('Listening audio changed during waveform generation');
        }
        const payload = Buffer.allocUnsafe(8 + result.peaks.length * 2);
        payload.writeDoubleLE(result.duration);
        for (let i = 0; i < result.peaks.length; i++) payload.writeUInt16LE(result.peaks[i] * 32768, 8 + i * 2);
        const temporary = cachePath + '.' + randomUUID() + '.tmp';
        try {
            await fs.writeFile(temporary, Buffer.concat([checksum(source, payload), payload]), { flag: 'wx', signal });
            signal.throwIfAborted();
            await fs.rename(temporary, cachePath);
        } catch (error) {
            signal.throwIfAborted();
            console.warn('Failed to save waveform cache', error);
        } finally {
            await fs.rm(temporary, { force: true }).catch((error: unknown) => console.warn('Failed to remove temporary waveform cache', error));
        }
        return result;
    } finally { await audio.close(); }
};
