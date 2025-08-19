import {
    Container,
    Typography,
    Box,
    Stack,
    Button,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
    Paper,
    CircularProgress,
} from '@mui/material';
import React, { useState } from 'react';

declare global {
    interface Window {
        api: {
            transcribe: (lang: string) => Promise<string>;
            saveText: (content: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
        };
    }
}

const languages = [
    { code: 'en', label: 'English' },
    { code: 'ru', label: 'Русский' },
];

export const App: React.FC = () => {
    const [text, setText] = useState('');
    const [loading, setLoading] = useState(false);
    const [lang, setLang] = useState('ru');

    const handleClick = async () => {
        setLoading(true);
        try {
            const result = await window.api.transcribe(lang);

            setText(result);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!text) return;
        try {
            // В браузере — скачать файл через Blob
            if (!window.api?.saveText) {
                const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');

                a.href = url;
                a.download = 'transcript.txt';
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);

                return;
            }
            // В Electron — сохранить через IPC
            const res = await window.api.saveText(text);

            if (!res.ok) {
                console.error(res.error);
            }
        } catch (e) {
            console.error(e);
        }
    };

    return (
        <Container maxWidth="md">
            <Paper elevation={3} sx={{ p: 3, mt: 4 }}>
                <Typography variant="h5" gutterBottom={true}>
                    {'Whisper Transcription'}
                </Typography>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ mb: 2 }}>
                    <FormControl size="small" sx={{ minWidth: 180 }}>
                        <InputLabel id="lang-label">{'Язык'}</InputLabel>
                        <Select
                            labelId="lang-label"
                            value={lang}
                            label="Язык"
                            onChange={(e) => setLang(e.target.value)}
                        >
                            {languages.map(({ code, label }) => (
                                <MenuItem key={code} value={code}>{label}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    <Stack direction="row" spacing={2}>
                        <Button
                            variant="contained"
                            onClick={() => { handleClick().catch(console.error); }}
                            disabled={loading}
                            startIcon={loading ? <CircularProgress size={20} /> : undefined}
                        >
                            {loading ? 'Расшифровка..' : 'Выберите аудио'}
                        </Button>

                        <Button
                            variant="outlined"
                            color="secondary"
                            onClick={() => { handleSave().catch(console.error); }}
                            disabled={!text}
                            title={!text ? 'Нет текста для сохранения' : 'Сохранить в transcript.txt'}
                        >
                            {'Сохранить как .txt'}
                        </Button>
                    </Stack>
                </Stack>

                <Box
                    component="pre"
                    sx={{
                        whiteSpace: 'pre-wrap',
                        mt: 2,
                        p: 2,
                        bgcolor: 'background.default',
                        borderRadius: 1,
                        border: '1px solid',
                        borderColor: 'divider',
                        minHeight: 200,
                    }}
                >
                    {text || 'Здесь появится результат транскрипции…'}
                </Box>
            </Paper>
        </Container>
    );
};
