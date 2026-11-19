import type { SpeakerErrorCode } from '../types/transcription';

export { runNativeProcess as runSpeakerProcess } from './nativeProcess';

export class SpeakerAnalysisError extends Error {
    constructor(public readonly code: SpeakerErrorCode, options?: ErrorOptions) {
        super(code, options);
    }
}
