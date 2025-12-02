// theme.ts
import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
    spacing: 6,
    palette: {
        primary: {
            main: '#184b27ff',
        },
    },

    typography: {
        button: { textTransform: 'none' },
    },

    components: {
        MuiButton: {
            defaultProps: {
                size: 'small',
                disableElevation: true,
            },
            styleOverrides: {
                root: {
                    borderRadius: 6,
                    paddingInline: 10,
                    paddingBlock: 4,
                },
            },
        },
        MuiTextField: {
            defaultProps: {
                size: 'small',
                margin: 'dense',
            },
        },
        MuiFormControl: {
            defaultProps: {
                margin: 'dense',
                size: 'small',
            },
        },
        MuiIconButton: {
            defaultProps: {
                size: 'small',
            },
        },
        MuiListItem: {
            defaultProps: {
                dense: true,
            },
        },
    },
});
