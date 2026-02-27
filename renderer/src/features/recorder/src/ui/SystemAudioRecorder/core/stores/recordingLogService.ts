import { atoms } from 'renderer/src/atoms';
import { jotaiStore } from 'renderer/src/store';

export interface RecordingLogService {
    append: (message: string) => void;
}

export class TranscriptionRecordingLogService implements RecordingLogService {
    append(message: string): void {
        jotaiStore.set(atoms.transcription.log, (prev) => {
            const prefix = prev ? '\n' : '';
            const timestamp = new Date().toLocaleTimeString();

            return `${prev}${prefix}[${timestamp}] ${message}`;
        });
    }
}
