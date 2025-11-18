import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const theme = createTheme({
    palette: {
        primary: {
            main: '#d5eed1',
        },
    },
});

const container = document.getElementById('root')!;
const root = createRoot(container);

root.render(
    <ThemeProvider theme={theme}>
        <CssBaseline />
        <App />
    </ThemeProvider>,
);
