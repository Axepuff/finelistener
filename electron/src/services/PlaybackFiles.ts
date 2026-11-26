import { createReadStream, type ReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { getFileByteRange } from '../utils/fileByteRange';

interface PlaybackRead {
    filePath: string;
    stop: AbortController;
    closed: Promise<boolean>;
}

const isInside = (directory: string, filePath: string): boolean => {
    const relative = path.relative(directory, filePath);
    return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};

export class PlaybackFiles {
    private readonly reads = new Set<PlaybackRead>();
    private readonly blockedDirectories = new Set<string>();

    public async serve(filePath: string, request: Request): Promise<Response> {
        if (Array.from(this.blockedDirectories).some((directory) => isInside(directory, filePath))) {
            return new Response(null, { status: 409 });
        }

        const closed = Promise.withResolvers<boolean>();
        const read = { filePath, stop: new AbortController(), closed: closed.promise };
        this.reads.add(read);
        const signal = AbortSignal.any([read.stop.signal, request.signal]);
        const finish = (success: boolean) => {
            this.reads.delete(read);
            closed.resolve(success);
        };
        let stream: ReadStream | undefined;

        try {
            const file = await stat(filePath);
            signal.throwIfAborted();
            if (!file.isFile()) return new Response(null, { status: 404 });
            const rangeHeader = request.headers.get('Range');
            const range = rangeHeader ? getFileByteRange(rangeHeader, file.size) : null;
            const headers = new Headers({ 'Accept-Ranges': 'bytes', 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' });
            if (rangeHeader && !range) {
                headers.set('Content-Range', `bytes */${file.size}`);
                return new Response(null, { status: 416, headers });
            }
            if (range) headers.set('Content-Range', `bytes ${range.start}-${range.end}/${file.size}`);
            headers.set('Content-Length', String(range ? range.end - range.start + 1 : file.size));
            const status = range ? 206 : 200;
            if (request.method === 'HEAD') return new Response(null, { status, headers });

            stream = createReadStream(filePath, { ...range, signal });
            let closeFailed = false;
            stream.on('error', (error: NodeJS.ErrnoException) => {
                if (error.syscall === 'close') {
                    closeFailed = true;
                    console.error('Failed to close the playback file', error);
                }
            });
            // The close event follows descriptor release, including when a read was in flight.
            stream.once('close', () => finish(!closeFailed));
            const body = Readable.toWeb(stream, {
                strategy: { highWaterMark: stream.readableHighWaterMark, size: (chunk: Buffer) => chunk.byteLength },
            });
            // Node and DOM declare the same Web Stream with different reader result types.
            return new Response(body as unknown as ReadableStream<Uint8Array>, { status, headers });
        } catch (error) {
            stream?.destroy();
            if (signal.aborted) return new Response(null, { status: 409 });
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Response(null, { status: 404 });
            throw error;
        } finally {
            if (!stream) finish(true);
        }
    }

    public async withFilesReleased(directory: string, action: () => Promise<void>): Promise<void> {
        if (this.blockedDirectories.has(directory)) throw new Error('Session playback is already being released.');
        this.blockedDirectories.add(directory);
        try {
            const reads = Array.from(this.reads).filter(({ filePath }) => isInside(directory, filePath));
            for (const read of reads) read.stop.abort();
            const released = await Promise.all(reads.map((read) => read.closed));
            if (released.includes(false)) throw new Error('Playback file could not be released.');
            await action();
        } finally {
            this.blockedDirectories.delete(directory);
        }
    }
}
