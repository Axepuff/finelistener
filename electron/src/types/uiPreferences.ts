export const UI_PREFERENCE_KEYS = ['homeSidebarWidth', 'homeRightSidebarWidth'] as const;

export type UiPreferenceKey = (typeof UI_PREFERENCE_KEYS)[number];

export interface UiPreferenceValueMap {
    homeSidebarWidth: number;
    homeRightSidebarWidth: number;
}

export const UI_PREFERENCE_DEFAULTS: UiPreferenceValueMap = {
    homeSidebarWidth: 420,
    homeRightSidebarWidth: 360,
};

export const isUiPreferenceKey = (value: unknown): value is UiPreferenceKey => {
    return typeof value === 'string' && (UI_PREFERENCE_KEYS as readonly string[]).includes(value);
};

export const isUiPreferenceValue = <K extends UiPreferenceKey>(
    key: K,
    value: unknown,
): value is UiPreferenceValueMap[K] => {
    if (key === 'homeSidebarWidth' || key === 'homeRightSidebarWidth') {
        return typeof value === 'number' && Number.isFinite(value);
    }

    return false;
};
