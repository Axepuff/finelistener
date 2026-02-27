import type { RecordingLevel } from 'electron/src/services/RecordingService';
import type { RecordingDevice } from 'electron/src/services/capture/CaptureAdapter';

export const formatDuration = (ms: number): string => {
    if (!Number.isFinite(ms) || ms < 0) return '0:00';

    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds - minutes * 60;

    return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

export const formatLevel = (level: RecordingLevel | null): string => {
    if (!level) return 'N/A';

    const peak = Math.round(level.peak * 100);
    const rms = Math.round(level.rms * 100);
    const clipped = level.clipped ? ' (clip)' : '';

    return `${peak}% peak, ${rms}% rms${clipped}`;
};

export const getRecordingDeviceId = (device: RecordingDevice): string => {
    if (device.id) return device.id;
    if (device.index !== undefined) return String(device.index);

    return '';
};

export const getErrorMessage = (error: unknown): string => {
    return error instanceof Error ? error.message : String(error);
};
