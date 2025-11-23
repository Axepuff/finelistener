import {
    Button,
    CircularProgress,
    FormControl,
    InputLabel,
    MenuItem,
    Select,
    Stack,
} from '@mui/material';
import { useAtom, useSetAtom } from 'jotai';
import React, { useState } from 'react';
import { atoms, type RegionTiming } from 'renderer/src/atoms';
import { useApp } from '../../../../../AppContext';
import { TranscribeAdvancedSettings } from '../TranscribeAdvancedSettings/TranscribeAdvancedSettings';

const { appState, transcription } = atoms;

const LANGS = [
    { code: 'auto', label: 'Авто' },
    { code: 'en', label: 'Английский' },
    { code: 'ru', label: 'Русский' },
    { code: 'es', label: 'Испанский' },
    { code: 'de', label: 'Немецкий' },
    { code: 'fr', label: 'Французский' },
];

const formatErrorMessage = (err: unknown): string => {
    if (err instanceof Error) return `${err.name}: ${err.message}`;

    return String(err);
};

const formatDuration = (ms: number): string => {
    if (!Number.isFinite(ms) || ms < 0) return '0 с';

    const totalSeconds = ms / 1000;

    if (totalSeconds < 60) return `${totalSeconds.toFixed(1)} с`;

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds - minutes * 60;

    return `${minutes} мин ${seconds.toFixed(1)} с`;
};

const getShortFileName = (target: string) => target.split(/[/\\]/).pop() || target;

interface Props {
    regions?: RegionTiming;
    onTranscribeStart: () => void;
    onTranscribeEnd: (regions?: RegionTiming) => void;
}

const TranscribeControl: React.FC<Props> = ({
    onTranscribeStart,
    onTranscribeEnd,
}) => {
    const { isElectron } = useApp();
    const [lang, setLang] = useState('ru');
    const [model, setModel] = useState<'large' | 'small'>('small');
    const [maxContext, setMaxContext] = useState<number>(64);
    const [maxLen, setMaxLen] = useState<number>(0);
    const [splitOnWord, setSplitOnWord] = useState<boolean>(true);
    const [useVad, setUseVad] = useState<boolean>(true);
    const [uiState, setUiState] = useAtom(appState.uiState);
    const setLog = useSetAtom(transcription.log);
    const [audioToTranscribe, setAudioToTranscribe] = useAtom(transcription.audioToTranscribe);

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
                appendLog(`Запускаем распознавание Whisper для ${getShortFileName(p)}`);
                const startedAt = performance.now();

                await window.api!.transcribeStream(p, {
                    language: lang,
                    model,
                    maxContext,
                    maxLen,
                    splitOnWord,
                    useVad,
                });
                const durationMs = performance.now() - startedAt;

                appendLog(`Распознавание Whisper завершено для ${getShortFileName(p)}`);
                appendLog(`Время транскрибирования ${getShortFileName(p)}: ${formatDuration(durationMs)}.`);
            }
        } catch (err) {
            appendLog(`Whisper завершился с ошибкой: ${formatErrorMessage(err)}`);
        } finally {
            onTranscribeEnd();
            setUiState('ready');
        }
    };

    const handleStop = async () => {
        try {
            const stopped = await window.api!.stopTranscription();

            if (stopped) {
                appendLog('Распознавание остановлено по запросу пользователя.');
            } else {
                appendLog('Сейчас ничего не распознается.');
            }
        } catch (err: unknown) {
            appendLog(`Не удалось остановить Whisper: ${formatErrorMessage(err)}`);
        } finally {
            setUiState('ready');
        }
    };

    const resetTranscriptionState = useSetAtom(atoms.reset);

    const handleClear = () => {
        setAudioToTranscribe([]);
        resetTranscriptionState();
    };

    const loading = uiState === 'transcribing';

    return (
        <Stack spacing={2}>
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
            <Stack direction="row" spacing={2}>
                <Button
                    variant="contained"
                    onClick={handleStart}
                    disabled={loading}
                    color="primary"
                    startIcon={loading ? <CircularProgress size={18} /> : undefined}
                >
                    {loading ? 'Распознаю...' : 'Распознать'}
                </Button>
                <Button onClick={handleStop} disabled={uiState !== 'transcribing'}>
                    {'Остановить'}
                </Button>
                <Button variant="outlined" onClick={handleClear}>{'Сброс'}</Button>
            </Stack>

            <TranscribeAdvancedSettings
                maxContext={maxContext}
                onChangeMaxContext={setMaxContext}
                maxLen={maxLen}
                onChangeMaxLen={setMaxLen}
                model={model}
                onChangeModel={setModel}
                splitOnWord={splitOnWord}
                onChangeSplitOnWord={setSplitOnWord}
                useVad={useVad}
                onChangeUseVad={setUseVad}
            />
        </Stack>
    );
};

export { TranscribeControl };
