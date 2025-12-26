import type { TranscribeOpts } from '../../controllers/transcriptionController';
import { formatVerboseJson, type WhisperVerboseResponse } from './utils';

interface InferencePayload {
    audioBuffer: Uint8Array<ArrayBuffer>;
    fileName: string;
    options: TranscribeOpts;
}

export type InferenceResponse =
    | {
        ok: true;
        text: string;
    }
    | {
        ok: false;
        status: number;
        statusText: string;
        errorText: string;
    };

const fetchWithTimeout = async (url: string, init: RequestInit = {}, timeoutMs = 5000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
};

export class WhisperServerApiClient {
    private readonly baseUrl: string;

    constructor(baseUrl: string) {
        this.baseUrl = baseUrl;
    }

    public async health(timeoutMs = 2000): Promise<boolean> {
        const res = await fetchWithTimeout(`${this.baseUrl}/health`, {}, timeoutMs);

        return res.ok;
    }

    public async loadModel(modelPath: string, timeoutMs = 10_000): Promise<void> {
        const form = new FormData();

        form.append('model', modelPath);

        const res = await fetchWithTimeout(`${this.baseUrl}/load`, { method: 'POST', body: form }, timeoutMs);

        if (!res.ok) {
            const errorText = await res.text().catch(() => '');

            throw new Error(
                `Failed to load model for whisper-server (${res.status}): ${errorText || res.statusText}`,
            );
        }
    }

    public async inference(payload: InferencePayload, signal?: AbortSignal): Promise<InferenceResponse> {
        const form = new FormData();
        const fileBlob = new Blob([payload.audioBuffer]);

        form.append('file', fileBlob, payload.fileName || 'audio.wav');
        form.append('response_format', 'verbose_json');

        const opts = payload.options;

        if (opts.language) form.append('language', opts.language);
        if (typeof opts.maxContext === 'number') form.append('max_context', String(opts.maxContext));
        if (typeof opts.maxLen === 'number' && opts.maxLen > 0) form.append('max_len', String(opts.maxLen));
        if (typeof opts.splitOnWord === 'boolean') form.append('split_on_word', String(opts.splitOnWord));
        if (typeof opts.useVad === 'boolean') form.append('vad', String(opts.useVad));
        form.append('--beam-size', '10');

        const response = await fetch(`${this.baseUrl}/inference`, {
            method: 'POST',
            body: form,
            signal,
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => '');

            return {
                ok: false,
                status: response.status,
                statusText: response.statusText,
                errorText,
            };
        }

        const contentType = response.headers.get('content-type') ?? '';

        if (contentType.includes('application/json')) {
            const payloadJson = (await response.json()) as WhisperVerboseResponse;

            return {
                ok: true,
                text: formatVerboseJson(payloadJson),
            };
        }

        return {
            ok: true,
            text: await response.text(),
        };
    }
}
