import { atom } from 'jotai';
import type { RecordingLogService } from './recordingLogService';
import type { RecordingDependencies } from './recordingStoreTypes';

interface RecordingSupportActionsDependencies extends RecordingDependencies {
    logService: RecordingLogService;
}

export class RecordingSupportActionsStore {
    readonly openRecordingPreferencesAtom = atom(null, async () => {
        const api = this.dependencies.getApi();

        if (!api) {
            return;
        }

        try {
            await api.openRecordingPreferences?.();
        } catch (error: unknown) {
            console.error('Failed to open recording preferences', error);
        }
    });

    readonly revealDevAppAtom = atom(null, async () => {
        const api = this.dependencies.getApi();

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
    });

    constructor(private readonly dependencies: RecordingSupportActionsDependencies) {}
}
