import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';

interface WhisperServerProcessHandlers {
    onStdoutData: (chunk: unknown) => void;
    onStderrData: (chunk: unknown) => void;
    onExit: (code: number | null) => void;
}

export class WhisperServerProcess {
    private server: ChildProcessWithoutNullStreams | null = null;
    private readonly handlers: WhisperServerProcessHandlers;

    constructor(handlers: WhisperServerProcessHandlers) {
        this.handlers = handlers;
    }

    public isRunning(): boolean {
        return Boolean(this.server);
    }

    public start(serverBinPath: string, args: string[], env: NodeJS.ProcessEnv) {
        this.server = spawn(serverBinPath, args, { env });

        this.server.stdout?.setEncoding('utf8');
        this.server.stdout?.on('data', this.handlers.onStdoutData);

        this.server.stderr?.setEncoding('utf8');
        this.server.stderr?.on('data', this.handlers.onStderrData);

        this.server.on('close', (code) => {
            this.server = null;
            this.handlers.onExit(code);
        });
    }

    public stop(): boolean {
        if (!this.server) return false;

        try {
            this.server.kill('SIGINT');
        } catch {
            // ignore
        } finally {
            this.server = null;
        }

        return true;
    }
}
