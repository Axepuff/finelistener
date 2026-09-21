export type DeepReadonly<T> = {
    readonly [K in keyof T]: DeepReadonly<T[K]>;
};

export type CommandResult<T = void> =
    | { ok: true; value: T }
    | { ok: false; message: string };

export interface Segment {
    start: number;
    end: number;
}

export interface SegmentSelection {
    start?: number;
    end?: number;
}

export type AudioMode = 'original' | 'optimized';

export type ForegroundOperationKind =
    | 'importing'
    | 'opening-session'
    | 'recording'
    | 'processing-recording'
    | 'recovering-recording'
    | 'discarding-recording'
    | 'optimizing-audio'
    | 'transcribing';

export interface ForegroundOperation {
    id: number;
    kind: ForegroundOperationKind;
}

export const commandSuccess = <T>(value: T): CommandResult<T> => ({ ok: true, value });

export const commandFailure = (message: string): CommandResult<never> => ({ ok: false, message });

export const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) return error.message;

    return String(error);
};
