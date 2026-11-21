/**
 * FineListener design-system tokens (light theme), copied from `docs/design/tokens.json`.
 * Every key becomes a CSS variable of the same name: `--brand-color-text`, `--brand-border-radius`, ...
 * See "Text contrast" in `docs/design/README.md`: readable text uses only `text` or `text-secondary`.
 */

export const brandColors = {
    'brand-color-primary': '#2e2e2e',
    'brand-color-primary-hover': '#3b3b3b',
    'brand-color-primary-active': '#080808',

    'brand-color-text': '#1f1f1f',
    // All secondary and small text: captions, timecodes, metadata (7:1 on white).
    'brand-color-text-secondary': '#595959',
    // 3.36:1 on white: non-text graphics only, never text.
    'brand-color-text-tertiary': '#8c8c8c',
    // Disabled controls only.
    'brand-color-text-quaternary': '#bfbfbf',

    'brand-color-bg-layout': '#f5f5f5',
    'brand-color-bg-container': '#ffffff',
    'brand-color-bg-elevated': '#ffffff',

    'brand-color-border': '#d9d9d9',
    'brand-color-border-secondary': '#f0f0f0',

    'brand-color-fill': '#d9d9d9',
    'brand-color-fill-secondary': '#f0f0f0',
    'brand-color-fill-tertiary': '#f5f5f5',
    'brand-color-fill-quaternary': '#fafafa',

    'brand-color-info': '#228be6',
    'brand-color-info-bg': '#f0faff',
    'brand-color-info-border': '#a1ddff',
    'brand-color-link': '#228be6',
    'brand-color-link-hover': '#4baaf2',
    // Long links and links in body text.
    'brand-color-link-active': '#136abf',

    'brand-color-success': '#2b8a3e',
    'brand-color-success-bg': '#bdc9be',
    'brand-color-success-border': '#8bb08f',
    'brand-color-warning': '#e67700',
    'brand-color-warning-bg': '#fff7e6',
    'brand-color-warning-border': '#ffcc7a',
    'brand-color-error': '#fa5252',
    'brand-color-error-bg': '#fff2f0',
    'brand-color-error-border': '#ffd3cf',
} as const;

/** Speaker label ramps: step 1 for the label background, step 8 for the label text. */
const speakerRamps = {
    green: ['#f6ffed', '#d9f7be', '#b6eb8f', '#94de64', '#72d13d', '#52c41a', '#389e0d', '#227804', '#135200', '#092b00'],
    volcano: ['#fff2e8', '#ffd8bf', '#ffbb96', '#ff9c6e', '#ff7a45', '#fa541c', '#d4380d', '#ad2202', '#871500', '#610c00'],
    purple: ['#f9f0ff', '#efdbff', '#d4adf7', '#b37feb', '#9254de', '#722ed1', '#531dab', '#391085', '#22075e', '#120338'],
} as const;

export const brandSpeakerColors = Object.fromEntries(
    Object.entries(speakerRamps).flatMap(([name, ramp]) => ramp.map((value, index) => [`brand-presets-${name}-${index + 1}`, value])),
) as Record<string, string>;

export const brandFonts = {
    'brand-font-family': '-apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif',
    // Timecodes, file paths and model names.
    'brand-font-family-code': 'ui-monospace, \'SF Mono\', Menlo, Consolas, monospace',
    'brand-font-size': '14px',
    'brand-font-size-sm': '12px',
    'brand-font-size-lg': '18px',
    'brand-font-size-xl': '22px',
    'brand-line-height': '1.5714285714285714',
    'brand-line-height-heading': '1.25',
    'brand-font-weight': '400',
    'brand-font-weight-strong': '600',
} as const;

export const brandSizes = {
    'brand-size-xxs': '4px',
    'brand-size-xs': '8px',
    'brand-size-sm': '12px',
    'brand-size': '16px',
    'brand-size-md': '20px',
    'brand-size-lg': '24px',
    'brand-size-xl': '32px',
    'brand-size-xxl': '48px',

    'brand-border-radius-xs': '1px',
    'brand-border-radius-sm': '3px',
    'brand-border-radius': '4px',
    'brand-border-radius-lg': '6px',

    'brand-control-height-xs': '16px',
    'brand-control-height-sm': '24px',
    'brand-control-height': '32px',
    'brand-control-height-lg': '40px',
    'brand-line-width': '1px',
} as const;

export const brandTokens = {
    ...brandColors,
    ...brandSpeakerColors,
    ...brandFonts,
    ...brandSizes,
    // Focus: primary border plus a 3px ring (blue is reserved for links, focus and the playhead).
    'brand-focus-ring': '0 0 0 3px rgba(34, 139, 230, 0.25)',
};

/** Token value as a CSS variable reference, e.g. `brandVar('brand-color-text')` → `var(--brand-color-text)`. */
export const brandVar = (name: keyof typeof brandTokens | `brand-presets-${string}`) => `var(--${name})`;
