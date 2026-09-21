import type { RecordingLogService } from './recordingLogService';
import type { RecordingDependencies } from './recordingStoreTypes';

interface RecordingSupportActionsDependencies extends RecordingDependencies {
    logService: RecordingLogService;
}

export class RecordingSupportActionsStore {
    constructor(private readonly dependencies: RecordingSupportActionsDependencies) {}

    async openRecordingPreferences(): Promise<void> {
        const api = this.dependencies.adapter;

        if (!api) {
            return;
        }

        try {
            await api.openRecordingPreferences?.();
        } catch (error: unknown) {
            console.error('Failed to open recording preferences', error);
        }
    }

    async revealDevApp(): Promise<void> {
        const api = this.dependencies.adapter;

        if (!api) {
            return;
        }

        try {
            const ok = await api.revealDevAppInFinder?.();

            if (!ok) {
                this.dependencies.logService.append(
                    "Couldn't reveal the dev app bundle. Make sure you're running via `npm run dev`.",
                );
            }
        } catch (error: unknown) {
            console.error('Failed to reveal dev app bundle', error);
        }
    }
}
