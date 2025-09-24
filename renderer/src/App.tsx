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
    TextField,
    FormControlLabel,
    Checkbox,
} from '@mui/material';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppContext } from './AppContext';

declare global {
    interface Window {
        api?: {
            pickAudio: () => Promise<string | null>;
            transcribeStream: (audioPath: string, opts: any) => Promise<string>;
            saveText: (content: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
            onTranscribeProgress: (cb: (chunk: string) => void) => () => void;
            onTranscribeLog: (cb: (line: string) => void) => () => void;
            stopTranscription: () => Promise<boolean>;
        };
    }
}

const LANGS = [
    { code: 'auto', label: 'Auto' },
    { code: 'en', label: 'English' },
    { code: 'ru', label: 'Русский' },
    { code: 'es', label: 'Español' },
    { code: 'de', label: 'Deutsch' },
    { code: 'fr', label: 'Français' },
];

export const App: React.FC = () => {
    const isElectron = useMemo(() => !!window.api, []);
    const [lang, setLang] = useState('ru');
    const [text, setText] = useState('');
    const [log, setLog] = useState('');
    const [isStopping, setIsStopping] = useState<boolean>(false);
    const [loading, setLoading] = useState(false);
    const [audioPath, setAudioPath] = useState<string>('');

    // опции чанкования / контекста
    const [maxContext, setMaxContext] = useState<number>(128);
    const [maxLen, setMaxLen] = useState<number>(0); // 0 = по умолчанию
    const [splitOnWord, setSplitOnWord] = useState<boolean>(true);
    const [useVad, setUseVad] = useState<boolean>(false);
    const [vadModelPath, setVadModelPath] = useState<string>(''); // ggml-silero-*.bin

    useEffect(() => {
        if (!isElectron) return;
        const off1 = window.api!.onTranscribeProgress((chunk) => setText((t) => t + chunk));
        const off2 = window.api!.onTranscribeLog((line) => setLog((l) => l + line));

        return () => {
            off1?.();
            off2?.();
        };
    }, [isElectron]);

    const handlePick = async () => {
        if (!isElectron) return;
        const file = await window.api!.pickAudio();

        if (file) setAudioPath(file);
    };

    const handleStart = async () => {
        if (!isElectron || !audioPath) return;
        setText('');
        setLog('');
        setLoading(true);
        try {
            await window.api!.transcribeStream(audioPath, {
                language: lang,
                maxContext,
                maxLen,
                splitOnWord,
                useVad,
                vadModelPath,
            });
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!text) return;
        await window.api!.saveText(text);
    };

    const handleStop = async () => {
        setIsStopping(true);
        try {
            const stopped = await window.api!.stopTranscription();

            if (stopped) {
                setLog(log + 'Команда остановки отправлена.');
            } else {
                setLog(log + 'Процесс не был запущен — останавливать нечего.');
            }
        } catch (err: unknown) {
            setLog(log + `Ошибка остановки: ${(err as Error)?.message ?? String(err)}`);
        } finally {
            setIsStopping(false);
        }
    };

    return (
        <AppContext value={{ isElectron: !!window.api }}>
            <Container maxWidth="md">
                <Paper elevation={3} sx={{ p: 3, mt: 4 }}>
                    <Typography variant="h5" gutterBottom={true}>
                        {'Whisper Transcription (stream)'}
                    </Typography>

                    <Stack
                        spacing={2}
                        direction={{ xs: 'column', sm: 'row' }}
                        alignItems="flex-start"
                    >
                        <FormControl size="small" sx={{ minWidth: 160 }}>
                            <InputLabel id="lang-label">{'Язык'}</InputLabel>
                            <Select
                                labelId="lang-label"
                                label="Язык"
                                value={lang}
                                onChange={(e) => setLang(e.target.value)}
                            >
                                {LANGS.map((l) => (
                                    <MenuItem key={l.code} value={l.code}>
                                        {l.label}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        <TextField
                            size="small"
                            label="--max-context"
                            type="number"
                            value={maxContext}
                            onChange={(e) => setMaxContext(Number(e.target.value))}
                            helperText="Количество токенов контекста (напр. 64–224)"
                        />
                        <TextField
                            size="small"
                            label="--max-len"
                            type="number"
                            value={maxLen}
                            onChange={(e) => setMaxLen(Number(e.target.value))}
                            helperText="Макс. длина сегмента (символы, 0 = авто)"
                        />
                    </Stack>

                    <Stack spacing={2} direction={{ xs: 'column', sm: 'row' }} sx={{ mt: 2 }}>
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={splitOnWord}
                                    onChange={(e) => setSplitOnWord(e.target.checked)}
                                />
                            }
                            label="--split-on-word"
                        />
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={useVad}
                                    onChange={(e) => setUseVad(e.target.checked)}
                                />
                            }
                            label="--vad (резать по речи)"
                        />
                    </Stack>

                    <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
                        <Button variant="outlined" onClick={handlePick}>
                            {'Выбрать аудио'}
                        </Button>
                        <Button
                            variant="contained"
                            onClick={handleStart}
                            disabled={loading}
                            color="primary"
                            startIcon={loading ? <CircularProgress size={18} /> : undefined}
                        >
                            {loading ? 'Распознаём…' : 'Старт'}
                        </Button>
                        <Button onClick={handleStop} disabled={!loading || isStopping}>
                            {'Остановить'}
                        </Button>
                        <Button variant="outlined" onClick={handleSave} disabled={!text}>
                            {'Save .txt'}
                        </Button>
                    </Stack>

                    <Typography variant="subtitle2" sx={{ mt: 2, opacity: 0.7 }}>
                        {audioPath || 'Файл не выбран'}
                    </Typography>

                    <Box
                        component="pre"
                        sx={{
                            whiteSpace: 'pre-wrap',
                            mt: 2,
                            p: 2,
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 1,
                            minHeight: '50%',
                        }}
                    >
                        {text || 'Здесь появится потоковая транскрипция…'}
                    </Box>

                    {log ? (
                        <Box
                            component="pre"
                            sx={{
                                whiteSpace: 'pre-wrap',
                                mt: 2,
                                p: 1.5,
                                bgcolor: 'background.default',
                                borderRadius: 1,
                                fontSize: 12,
                                opacity: 0.75,
                                maxHeight: 160,
                                overflow: 'auto',
                            }}
                        >
                            {log}
                        </Box>
                    ) : null}
                </Paper>
            </Container>
        </AppContext>
    );
};
