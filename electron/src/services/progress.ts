/**
 * Инкапсулирует разбор строк вида "progress = 10%" из stdout/stderr whisper.
 * Держим буфер между вызовами, чтобы не терять проценты на разорванных чанках.
 */
export const createProgressParser = (onProgress?: (value: number) => void) => {
    let progressBuffer = '';
    let lastProgressReported = -1;

    return (chunk: string) => {
        progressBuffer += chunk;

        const regex = /progress\s*=\s*(\d+)%/gi;
        let match: RegExpExecArray | null;
        let lastConsumedIdx = 0;

        while ((match = regex.exec(progressBuffer)) !== null) {
            lastConsumedIdx = Math.max(lastConsumedIdx, match.index + match[0].length);

            const progressValue = Number.parseInt(match[1], 10);

            if (!Number.isNaN(progressValue) && progressValue !== lastProgressReported) {
                lastProgressReported = progressValue;
                onProgress?.(progressValue);
            }
        }

        if (lastConsumedIdx > 0) {
            progressBuffer = progressBuffer.slice(lastConsumedIdx);
        } else if (progressBuffer.length > 256) {
            progressBuffer = progressBuffer.slice(-64);
        }
    };
};
