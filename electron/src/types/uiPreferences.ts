export const UI_PREFERENCE_KEYS = [
    'homeSidebarWidth', 'homeRightSidebarWidth', 'recordingSystemDevice', 'recordingMicrophoneDevice',
    'recordingRecoveryWarningDays', 'recordingRecoveryQuotaBytes', 'recordingDerivedCacheBudgetBytes',
] as const;

export type UiPreferenceKey = (typeof UI_PREFERENCE_KEYS)[number];

export interface UiPreferenceValueMap {
    recordingSystemDevice: string | null;
    recordingMicrophoneDevice: string | null;
    homeSidebarWidth: number;
    homeRightSidebarWidth: number;
    recordingRecoveryWarningDays: number;
    recordingRecoveryQuotaBytes: number;
    recordingDerivedCacheBudgetBytes: number;
}

export const UI_PREFERENCE_DEFAULTS: UiPreferenceValueMap = {
    recordingSystemDevice: '',
    recordingMicrophoneDevice: '',
    homeSidebarWidth: 420,
    homeRightSidebarWidth: 360,
    recordingRecoveryWarningDays: 14,
    recordingRecoveryQuotaBytes: 2 * 1024 * 1024 * 1024,
    recordingDerivedCacheBudgetBytes: 1024 * 1024 * 1024,
};

export const isUiPreferenceKey = (value: unknown): value is UiPreferenceKey => {
    return typeof value === 'string' && (UI_PREFERENCE_KEYS as readonly string[]).includes(value);
};

export const isUiPreferenceValue = <K extends UiPreferenceKey>(
    key: K,
    value: unknown,
): value is UiPreferenceValueMap[K] => {
    if (key === 'homeSidebarWidth' || key === 'homeRightSidebarWidth'
        || key === 'recordingRecoveryWarningDays' || key === 'recordingRecoveryQuotaBytes'
        || key === 'recordingDerivedCacheBudgetBytes') {
        return typeof value === 'number' && Number.isFinite(value) && value > 0;
    }

    if (key === 'recordingSystemDevice' || key === 'recordingMicrophoneDevice') {
        return value === null || typeof value === 'string';
    }

    return false;
};
