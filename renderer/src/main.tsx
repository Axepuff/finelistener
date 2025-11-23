import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const theme = createTheme({
    palette: {
        primary: {
            main: '#184b27ff',
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
