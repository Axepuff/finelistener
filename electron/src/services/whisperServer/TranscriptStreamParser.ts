const DEFAULT_MAX_BUFFER_LENGTH = 10_000;
const DEFAULT_TRIM_BUFFER_LENGTH = 2000;
const DEFAULT_TRANSCRIPT_LINE_REGEX =
    /^\[\d{2}:\d{2}:\d{2}\.\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}\.\d{3}\]\s+/;

interface TranscriptStreamParserParams {
    transcriptLineRegex?: RegExp;
    maxBufferLength?: number;
    trimBufferLength?: number;
}

export class TranscriptStreamParser {
    private buffer = '';
    private readonly transcriptLineRegex: RegExp;
    private readonly maxBufferLength: number;
    private readonly trimBufferLength: number;

    constructor(params: TranscriptStreamParserParams = {}) {
        this.transcriptLineRegex = params.transcriptLineRegex ?? DEFAULT_TRANSCRIPT_LINE_REGEX;
        this.maxBufferLength = params.maxBufferLength ?? DEFAULT_MAX_BUFFER_LENGTH;
        this.trimBufferLength = params.trimBufferLength ?? DEFAULT_TRIM_BUFFER_LENGTH;
    }

    public reset(): void {
        this.buffer = '';
    }

    public pushChunk(text: string): string[] {
        this.buffer += text;

        const lines = this.buffer.split('\n');

        this.buffer = lines.pop() ?? '';

        const result: string[] = [];

        for (const line of lines) {
            const cleanedLine = line.replace(/\r$/, '');

            if (!this.transcriptLineRegex.test(cleanedLine)) continue;

            result.push(`${cleanedLine}\n`);
        }

        if (this.buffer.length > this.maxBufferLength) {
            this.buffer = this.buffer.slice(-this.trimBufferLength);
        }

        return result;
    }
}
