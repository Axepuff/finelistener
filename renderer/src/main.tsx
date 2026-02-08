import '@mantine/core/styles.css';
import '@fontsource/roboto/300.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import {
    ActionIcon,
    Button,
    Checkbox,
    MantineProvider,
    NumberInput,
    Select,
    Switch,
    TextInput,
    createTheme as createMantineTheme,
} from '@mantine/core';
import { Provider } from 'jotai';
import { createRoot } from 'react-dom/client';
import { jotaiStore } from 'renderer/src/store';
import { App } from './App';

const mantineTheme = createMantineTheme({
    primaryColor: 'dark',
    defaultRadius: 'xs',
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

const container = document.getElementById('root')!;
const root = createRoot(container);

root.render(
    <Provider store={jotaiStore}>
        <MantineProvider defaultColorScheme="light" theme={mantineTheme}>
            <App />
        </MantineProvider>
    </Provider>,
);
