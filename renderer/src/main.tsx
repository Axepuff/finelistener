import '@fontsource/roboto/300.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { Provider } from 'jotai';
import { createRoot } from 'react-dom/client';
import { jotaiStore } from 'renderer/src/store';
import { theme } from 'renderer/src/theme';
import { App } from './App';

const container = document.getElementById('root')!;
const root = createRoot(container);

root.render(
    <Provider store={jotaiStore}>
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <App />
        </ThemeProvider>
    </Provider>,
);
