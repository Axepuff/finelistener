import { Button, Checkbox, CircularProgress, FormControl, FormControlLabel, Grow, Stack, Switch, TextField } from '@mui/material';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import { Fragment, useState, type FC } from 'react';
import { useApp } from '../../../../../AppContext';

const LANGS = [
    { code: 'auto', label: 'Auto' },
    { code: 'en', label: 'English' },
    { code: 'ru', label: 'Русский' },
    { code: 'es', label: 'Español' },
    { code: 'de', label: 'Deutsch' },
    { code: 'fr', label: 'Français' },
];

type Props = {
    audioToTranscribe?: string;
};

export const TranscribeControl: FC<Props> = ({ audioToTranscribe }) => {
    const { isElectron } = useApp();
    const [lang, setLang] = useState('ru');
    const [isStopping, setIsStopping] = useState<boolean>(false);
    const [loading, setLoading] = useState(false);
    const [maxContext, setMaxContext] = useState<number>(128);
    const [maxLen, setMaxLen] = useState<number>(0); // 0 = по умолчанию
    const [splitOnWord, setSplitOnWord] = useState<boolean>(true);
    const [useVad, setUseVad] = useState<boolean>(false);
    const [collapseSettings, setCollapseSettings] = useState(false);

    const handleStart = async () => {
        if (!isElectron || !audioToTranscribe) return;
        setLoading(true);
        try {
            await window.api!.transcribeStream(audioToTranscribe, {
                language: lang,
                maxContext,
                maxLen,
                splitOnWord,
                useVad,
            });
        } finally {
            setLoading(false);
        }
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
        <Stack>
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
            </Stack>

            <FormControlLabel
                control={(
                    <Switch checked={collapseSettings} onChange={() => {
                        setCollapseSettings((prev) => !prev);
                    }}
                    />
                )}
                label="Расширенные настройки"
            />
            <Grow in={collapseSettings}>
                <Stack>
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
                    <FormControlLabel
                        control={(
                            <Checkbox
                                checked={splitOnWord}
                                onChange={(e) => setSplitOnWord(e.target.checked)}
                            />
                        )}
                        label="--split-on-word"
                    />
                    <FormControlLabel
                        control={(
                            <Checkbox
                                checked={useVad}
                                onChange={(e) => setUseVad(e.target.checked)}
                            />
                        )}
                        label="--vad (резать по речи)"
                    />
                </Stack>
            </Grow>
        </Stack>
    );
};
