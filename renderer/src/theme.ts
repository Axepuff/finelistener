import {
    ActionIcon,
    Button,
    Checkbox,
    NumberInput,
    Select,
    Switch,
    TextInput,
    createTheme as createMantineTheme,
} from '@mantine/core';

export const mantineTheme = createMantineTheme({
    primaryColor: 'dark',
    defaultRadius: 'sm',
    scale: 1,
    components: {
        Button: Button.extend({
            defaultProps: {
                size: 'sm',
            },
            vars: (_theme, props) => {
                if (props.size === 'md') {
                    return {
                        root: {
                            '--button-height': '32px',
                            '--button-padding-x': '12px',
                        },
                    };
                }

                return { root: {} };
            },
        }),
        ActionIcon: ActionIcon.extend({
            defaultProps: {
                size: 'sm',
            },
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
            },
        }),
        Switch: Switch.extend({
            defaultProps: {
                size: 'sm',
            },
        }),
    },
});
