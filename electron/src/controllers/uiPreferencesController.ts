import type { BrowserWindow, IpcMain } from 'electron';
import Store from 'electron-store';
import {
    UI_PREFERENCE_DEFAULTS,
    isUiPreferenceKey,
    isUiPreferenceValue,
    type UiPreferenceValueMap,
} from '../types/uiPreferences';

const uiPreferencesStore = new Store<UiPreferenceValueMap>({
    name: 'ui-preferences',
    defaults: UI_PREFERENCE_DEFAULTS,
});

export function registerUiPreferencesController(ipc: IpcMain, _getMainWindow: () => BrowserWindow | null): void {
    // IPC channel to read a persisted UI preference from electron-store.
    ipc.handle('ui-preferences:get', (_event, key: unknown) => {
        if (!isUiPreferenceKey(key)) {
            throw new Error('Invalid ui preference key');
        }

        return uiPreferencesStore.get(key);
    });

    // IPC channel to persist a validated UI preference value into electron-store.
    ipc.handle('ui-preferences:set', (_event, key: unknown, value: unknown) => {
        if (!isUiPreferenceKey(key)) {
            throw new Error('Invalid ui preference key');
        }
        if (!isUiPreferenceValue(key, value)) {
            throw new Error(`Invalid ui preference value for key "${key}"`);
        }

        uiPreferencesStore.set(key, value);

        return uiPreferencesStore.get(key);
    });
}
