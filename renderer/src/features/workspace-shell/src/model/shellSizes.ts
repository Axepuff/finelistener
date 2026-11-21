// Sizes from docs/design/README.md, "Window size and panel widths".
// electron/main.ts keeps its own copy of the minimum window size.
export const SHELL_SIZES = {
    titleBarHeight: 48,
    statusBarHeight: 28,
    sessionsPanel: { defaultWidth: 300, minWidth: 240, maxWidth: 480 },
    settingsPanel: { defaultWidth: 360, minWidth: 320, maxWidth: 480 },
    transcriptMinWidth: 440,
    logHeight: 240,
} as const;
