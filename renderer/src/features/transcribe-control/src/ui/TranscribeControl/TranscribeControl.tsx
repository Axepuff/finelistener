import { Button, Checkbox, CircularProgress, FormControl, FormControlLabel, Grow, Stack, Switch, TextField } from '@mui/material';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import { useAtom, useSetAtom } from 'jotai';
import { useState, type FC } from 'react';
import { atoms, type RegionTiming } from 'renderer/src/atoms';
import { useApp } from '../../../../../AppContext';

const { appState, transcription } = atoms;

const LANGS = [
    { code: 'auto', label: 'Auto' },
    { code: 'en', label: 'English' },
    { code: 'ru', label: 'Russian' },
    { code: 'es', label: 'Spanish' },
    { code: 'de', label: 'German' },
    { code: 'fr', label: 'French' },
];

const formatErrorMessage = (err: unknown): string => {
    if (err instanceof Error) return `${err.name}: ${err.message}`;

    return String(err);
};

const getShortFileName = (target: string) => target.split(/[/\\]/).pop() || target;

type Props = {
    audioToTranscribe?: string | string[];
    regions?: RegionTiming;
    onTranscribeStart: () => void;
    onTranscribeEnd: (regions?: RegionTiming) => void;
};

export const TranscribeControl: FC<Props> = ({
    audioToTranscribe,
    onTranscribeStart,
    onTranscribeEnd,
}) => {
    const { isElectron } = useApp();
    const [lang, setLang] = useState('ru');
    const [maxContext, setMaxContext] = useState<number>(64);
    const [maxLen, setMaxLen] = useState<number>(0);
    const [splitOnWord, setSplitOnWord] = useState<boolean>(true);
    const [useVad, setUseVad] = useState<boolean>(true);
    const [collapseSettings, setCollapseSettings] = useState(false);
    const [uiState, setUiState] = useAtom(appState.uiState);
    const setLog = useSetAtom(transcription.log);

    const appendLog = (message: string) => {
        setLog((prev) => {
            const prefix = prev ? '\n' : '';
            const timestamp = new Date().toLocaleTimeString();

            return `${prev}${prefix}[${timestamp}] ${message}`;
        });
    };

    const handleStart = async () => {
        if (!isElectron || !audioToTranscribe) return;
        onTranscribeStart();

        setUiState('transcribing');
        const targets = Array.isArray(audioToTranscribe) ? audioToTranscribe : [audioToTranscribe];

        try {
            for (const p of targets) {
                appendLog(`Starting Whisper transcription for ${getShortFileName(p)}`);
                await window.api!.transcribeStream(p, {
                    language: lang,
                    maxContext,
                    maxLen,
                    splitOnWord,
                    useVad,
                });
                appendLog(`Finished Whisper transcription for ${getShortFileName(p)}`);
            }
        } catch (err) {
            appendLog(`Whisper process failed: ${formatErrorMessage(err)}`);
        } finally {
            onTranscribeEnd();
            setUiState('ready');
        }
    };

    const handleStop = async () => {
        try {
            const stopped = await window.api!.stopTranscription();

            if (stopped) {
                appendLog('Transcription interrupted by user request.');
            } else {
                appendLog('No Whisper process was running.');
            }
        } catch (err: unknown) {
            appendLog(`Failed to stop Whisper process: ${formatErrorMessage(err)}`);
        } finally {
            setUiState('ready');
        }
    };

    const loading = uiState === 'transcribing';

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
                <Button
                    variant="contained"
                    onClick={handleStart}
                    disabled={loading}
                    color="primary"
                    startIcon={loading ? <CircularProgress size={18} /> : undefined}
                >
                    {loading ? 'Распознаём…' : 'Старт'}
                </Button>
                <Button onClick={handleStop} disabled={uiState !== 'transcribing'}>
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
            <Grow in={collapseSettings} mountOnEnter={true} unmountOnExit={true}>
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
