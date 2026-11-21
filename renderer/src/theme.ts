import {
    ActionIcon,
    Badge,
    Button,
    Card,
    Checkbox,
    Modal,
    NumberInput,
    Select,
    Switch,
    TextInput,
    createTheme as createMantineTheme,
    type CSSVariablesResolver,
    type MantineColorsTuple,
} from '@mantine/core';
import { brandColors, brandFonts, brandTokens } from './designTokens';

// Neutral ramp around the near-black primary; shade 6 is the filled color.
const brand: MantineColorsTuple = [
    brandColors['brand-color-fill-quaternary'],
    brandColors['brand-color-fill-secondary'],
    brandColors['brand-color-border'],
    brandColors['brand-color-text-quaternary'],
    brandColors['brand-color-text-tertiary'],
    brandColors['brand-color-text-secondary'],
    brandColors['brand-color-primary'],
    brandColors['brand-color-primary-active'],
    '#000000',
    '#000000',
];

// Mantine's built-in borders, dividers and subtle variants read the gray ramp directly,
// so it is mapped onto the neutral tokens (shades 3 and 4 are the border color).
const gray: MantineColorsTuple = [
    brandColors['brand-color-fill-quaternary'],
    brandColors['brand-color-fill-tertiary'],
    brandColors['brand-color-fill-secondary'],
    brandColors['brand-color-border'],
    brandColors['brand-color-border'],
    // Placeholders and non-text graphics.
    brandColors['brand-color-text-tertiary'],
    // Shade 6 colors light/subtle variant text (e.g. gray badges), so it must meet 4.5:1.
    brandColors['brand-color-text-secondary'],
    '#434343',
    brandColors['brand-color-primary'],
    brandColors['brand-color-text'],
];

type VariantProps = { variant?: string; color?: string };

// Filled buttons in the primary color get `brand-primary-filled`; theme.css gives them the pressed color.
const primaryFilledClassName = (props: VariantProps) => (
    (props.variant ?? 'filled') === 'filled' && (props.color === undefined || props.color === 'brand') ?
        'brand-primary-filled' :
        undefined
);

/** Exposes every token as `--brand-*` and points Mantine's own variables at the tokens. */
export const cssVariablesResolver: CSSVariablesResolver = () => {
    const brandVariables = Object.fromEntries(Object.entries(brandTokens).map(([name, value]) => [`--${name}`, value]));
    const mantineOverrides = {
        '--mantine-color-body': 'var(--brand-color-bg-container)',
        '--mantine-color-text': 'var(--brand-color-text)',
        // `c="dimmed"` is used for small and secondary text, so it must meet 4.5:1.
        '--mantine-color-dimmed': 'var(--brand-color-text-secondary)',
        // Placeholders are readable text too; tertiary stays for non-text graphics.
        '--mantine-color-placeholder': 'var(--brand-color-text-secondary)',
        '--mantine-color-default-border': 'var(--brand-color-border)',
        '--mantine-color-default-hover': 'var(--brand-color-fill-tertiary)',
        '--mantine-color-anchor': 'var(--brand-color-link)',
        '--mantine-color-error': 'var(--brand-color-error)',
        '--mantine-color-disabled': 'var(--brand-color-fill-tertiary)',
        '--mantine-color-disabled-color': 'var(--brand-color-text-quaternary)',
        '--mantine-color-disabled-border': 'var(--brand-color-border)',
        '--mantine-primary-color-filled': 'var(--brand-color-primary)',
        '--mantine-primary-color-filled-hover': 'var(--brand-color-primary-hover)',
        '--mantine-color-brand-filled': 'var(--brand-color-primary)',
        '--mantine-color-brand-filled-hover': 'var(--brand-color-primary-hover)',
    };

    return {
        variables: brandVariables,
        light: mantineOverrides,
        dark: {},
    };
};

export const mantineTheme = createMantineTheme({
    colors: { brand, gray },
    primaryColor: 'brand',
    primaryShade: 6,
    white: brandColors['brand-color-bg-container'],
    black: brandColors['brand-color-text'],
    scale: 1,
    fontFamily: brandFonts['brand-font-family'],
    fontFamilyMonospace: brandFonts['brand-font-family-code'],
    fontSizes: {
        xs: '12px',
        sm: '14px',
        md: '14px',
        lg: '18px',
        xl: '22px',
    },
    lineHeights: {
        xs: '1.6666666666666667',
        sm: brandFonts['brand-line-height'],
        md: brandFonts['brand-line-height'],
        lg: '1.5555555555555556',
        xl: '1.4545454545454546',
    },
    headings: {
        fontFamily: brandFonts['brand-font-family'],
        fontWeight: brandFonts['brand-font-weight-strong'],
        sizes: {
            h1: { fontSize: '38px', lineHeight: brandFonts['brand-line-height-heading'] },
            h2: { fontSize: '32px', lineHeight: brandFonts['brand-line-height-heading'] },
            h3: { fontSize: '26px', lineHeight: brandFonts['brand-line-height-heading'] },
            h4: { fontSize: '22px', lineHeight: brandFonts['brand-line-height-heading'] },
            // Panel headings: 18px / 600.
            h5: { fontSize: '18px', lineHeight: brandFonts['brand-line-height-heading'] },
            h6: { fontSize: '14px', lineHeight: brandFonts['brand-line-height'] },
        },
    },
    spacing: {
        xs: '8px',
        sm: '12px',
        md: '16px',
        lg: '24px',
        xl: '32px',
    },
    radius: {
        xs: '1px',
        sm: '3px',
        md: '4px',
        lg: '6px',
        xl: '6px',
    },
    defaultRadius: 'md',
    focusRing: 'auto',
    components: {
        Button: Button.extend({
            defaultProps: {
                size: 'sm',
            },
            classNames: (_theme, props) => ({ root: primaryFilledClassName(props) }),
        }),
        ActionIcon: ActionIcon.extend({
            defaultProps: {
                size: 'sm',
            },
            classNames: (_theme, props) => ({ root: primaryFilledClassName(props) }),
        }),
        Select: Select.extend({
            defaultProps: {
                size: 'sm',
            },
        }),
        NumberInput: NumberInput.extend({
            defaultProps: {
                size: 'sm',
            },
        }),
        TextInput: TextInput.extend({
            defaultProps: {
                size: 'sm',
            },
        }),
        Checkbox: Checkbox.extend({
            defaultProps: {
                size: 'sm',
                radius: 'sm',
            },
        }),
        Switch: Switch.extend({
            defaultProps: {
                size: 'sm',
            },
        }),
        Badge: Badge.extend({
            defaultProps: {
                radius: 'sm',
            },
        }),
        Card: Card.extend({
            defaultProps: {
                radius: 'lg',
            },
        }),
        Modal: Modal.extend({
            defaultProps: {
                radius: 'lg',
            },
        }),
    },
});
