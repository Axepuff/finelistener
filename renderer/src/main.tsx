import '@mantine/core/styles.css';
import '@fontsource/roboto/300.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import { MantineProvider } from '@mantine/core';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppContext } from './AppContext';
import { appStore } from './store';
import { mantineTheme } from './theme';

const container = document.getElementById('root')!;
const root = createRoot(container);

root.render(
    <AppContext value={appStore}>
        <MantineProvider defaultColorScheme="light" theme={mantineTheme}>
            <App />
        </MantineProvider>
    </AppContext>,
);
