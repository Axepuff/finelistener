import path from 'path';
import { WhisperServerApiClient } from './WhisperServerApiClient';
import { delay } from './utils';

const DEFAULT_HEALTH_RETRIES = 20;
const DEFAULT_HEALTH_DELAY_MS = 500;
const DEFAULT_HEALTH_TIMEOUT_MS = 2000;
const DEFAULT_LOAD_TIMEOUT_MS = 10_000;

interface WhisperModelManagerParams {
    apiClient: WhisperServerApiClient;
    isServerRunning: () => boolean;
    onLog?: (message: string) => void;
    healthRetries?: number;
    healthDelayMs?: number;
    healthTimeoutMs?: number;
    loadTimeoutMs?: number;
}

export class WhisperModelManager {
    private currentModelPath: string | null = null;
    private readonly apiClient: WhisperServerApiClient;
    private readonly isServerRunning: () => boolean;
    private readonly onLog?: (message: string) => void;
    private readonly healthRetries: number;
    private readonly healthDelayMs: number;
    private readonly healthTimeoutMs: number;
    private readonly loadTimeoutMs: number;

    constructor(params: WhisperModelManagerParams) {
        this.apiClient = params.apiClient;
        this.isServerRunning = params.isServerRunning;
        this.onLog = params.onLog;
        this.healthRetries = params.healthRetries ?? DEFAULT_HEALTH_RETRIES;
        this.healthDelayMs = params.healthDelayMs ?? DEFAULT_HEALTH_DELAY_MS;
        this.healthTimeoutMs = params.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
        this.loadTimeoutMs = params.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS;
    }

    public reset(): void {
        this.currentModelPath = null;
    }

    public async onServerStarted(modelPath: string): Promise<void> {
        await this.waitForHealth();
        this.currentModelPath = modelPath;
    }

    public async loadModelIfNeeded(modelPath: string): Promise<void> {
        if (this.currentModelPath === modelPath) return;

        this.onLog?.(`Model changed to ${path.basename(modelPath)}`);
        await this.apiClient.loadModel(modelPath, this.loadTimeoutMs);
        await this.waitForHealth();
        this.currentModelPath = modelPath;
    }

    private async waitForHealth(): Promise<void> {
        for (let attempt = 0; attempt < this.healthRetries; attempt += 1) {
            if (!this.isServerRunning()) {
                throw new Error('whisper-server is not running');
            }

            try {
                if (await this.apiClient.health(this.healthTimeoutMs)) return;
            } catch {
                // repeat
            }

            await delay(this.healthDelayMs);
        }

        throw new Error('whisper-server is not healthy /health');
    }
}
