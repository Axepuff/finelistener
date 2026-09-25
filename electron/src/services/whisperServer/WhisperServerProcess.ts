import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';

interface WhisperServerProcessHandlers {
    onStdoutData: (chunk: unknown) => void;
    onStderrData: (chunk: unknown) => void;
    onExit: (code: number | null) => void;
}

export class WhisperServerProcess {
    private server: ChildProcessWithoutNullStreams | null = null;
    private serverClosed: Promise<void> = Promise.resolve();
    private readonly handlers: WhisperServerProcessHandlers;

    constructor(handlers: WhisperServerProcessHandlers) {
        this.handlers = handlers;
    }

    public isRunning(): boolean {
        return Boolean(this.server);
    }

    public start(serverBinPath: string, args: string[], env: NodeJS.ProcessEnv) {
        const server = spawn(serverBinPath, args, { env });

        this.server = server;
        server.stdout?.setEncoding('utf8');
        server.stdout?.on('data', (chunk: unknown) => {
            if (this.server === server) this.handlers.onStdoutData(chunk);
        });

        server.stderr?.setEncoding('utf8');
        server.stderr?.on('data', (chunk: unknown) => {
            if (this.server === server) this.handlers.onStderrData(chunk);
        });

        server.on('error', (error) => {
            console.error('Whisper server process failed', error);
        });
        this.serverClosed = new Promise((resolve) => {
            server.once('close', (code) => {
                if (this.server === server) {
                    this.server = null;
                    this.handlers.onExit(code);
                }
                resolve();
            });
        });
    }

    public waitForExit(): Promise<void> {
        return this.serverClosed;
    }

    public stop(): boolean {
        if (!this.server) return false;

        try {
            if (!this.server.kill('SIGINT')) return false;

            // Drop trailing output immediately; a new server waits for close to release the port.
            this.server = null;
        } catch (error) {
            console.error('Failed to stop Whisper server', error);

            return false;
        }

        return true;
    }
}
