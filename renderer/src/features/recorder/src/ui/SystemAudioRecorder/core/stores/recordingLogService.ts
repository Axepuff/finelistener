import type { ActivityLogStore } from 'renderer/src/stores/activityLogStore';

export interface RecordingLogService {
    append: (message: string) => void;
}

export class TranscriptionRecordingLogService implements RecordingLogService {
    constructor(private readonly activityLog: ActivityLogStore) {}

    append(message: string): void {
        this.activityLog.appendEvent(message);
    }
}
