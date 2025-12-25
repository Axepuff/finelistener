export type TranscriptionCallbacks = {
    /** Передаём собранный текст пользователю */
    onStdoutChunk?: (chunk: string) => void;
    /** Технические логи и ошибки отправляем в отдельный канал */
    onStderrChunk?: (chunk: string) => void;
    /** Отображаем проценты прогресса по логам whisper */
    onProgressPercent?: (value: number) => void;
};
