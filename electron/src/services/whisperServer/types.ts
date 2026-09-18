import type { TranscriptionTextEvent, TranscriptionProgressEvent } from '../../types/transcription';

export type TranscriptionCallbacks = {
    /** Передаём собранный текст пользователю */
    onStdoutChunk?: (event: TranscriptionTextEvent) => void;
    /** Технические логи и ошибки отправляем в отдельный канал */
    onStderrChunk?: (chunk: string) => void;
    /** Отображаем проценты прогресса по логам whisper */
    onProgressPercent?: (event: TranscriptionProgressEvent) => void;
};
