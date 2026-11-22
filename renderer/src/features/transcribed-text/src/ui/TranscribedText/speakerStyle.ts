import type { CSSProperties } from 'react';
import type { SpeakerLabel } from 'renderer/src/stores/speakerReadingFormat';

export const speakerStyle = (label: SpeakerLabel): CSSProperties => ({
    '--speaker-background': label.clipboardBackground,
    '--speaker-border': label.accent,
    '--speaker-color': label.color,
} as CSSProperties);
