import { Blob } from 'buffer';
import { Agent, FormData, fetch as undiciFetch } from 'undici';
import type { RequestInit as UndiciRequestInit } from 'undici';
import type { TranscribeOpts } from '../../types/transcription';
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

const DEFAULT_HEADERS_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_BODY_TIMEOUT_MS = 15 * 60_000;
const whisperDispatcher = new Agent({
    headersTimeout: DEFAULT_HEADERS_TIMEOUT_MS,
    bodyTimeout: DEFAULT_BODY_TIMEOUT_MS,
});

const fetchWithTimeout = async (url: string, init: UndiciRequestInit = {}, timeoutMs = 5000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await undiciFetch(url, { ...init, signal: controller.signal, dispatcher: whisperDispatcher });
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
        form.append('--beam-size', '8');

        const response = await undiciFetch(`${this.baseUrl}/inference`, {
            method: 'POST',
            body: form,
            signal,
            dispatcher: whisperDispatcher,
        } satisfies UndiciRequestInit);

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
