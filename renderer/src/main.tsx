import '@mantine/core/styles.css';
import './theme.css';
import { MantineProvider } from '@mantine/core';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppContext } from './AppContext';
import { appStore } from './store';
import { cssVariablesResolver, mantineTheme } from './theme';

const container = document.getElementById('root')!;
const root = createRoot(container);

root.render(
    <AppContext value={appStore}>
        <MantineProvider defaultColorScheme="light" theme={mantineTheme} cssVariablesResolver={cssVariablesResolver}>
            <App />
        </MantineProvider>
    </AppContext>,
);
