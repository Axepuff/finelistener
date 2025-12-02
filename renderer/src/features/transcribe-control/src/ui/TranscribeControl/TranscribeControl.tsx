import { Earbuds, Stop } from '@mui/icons-material';
import {
    Button,
    CircularProgress,
    FormControl,
    IconButton,
    InputLabel,
    MenuItem,
    Select,
    Stack,
} from '@mui/material';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
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

const formatSeconds = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0 с';

    return `${seconds.toFixed(2)} с`;
};

const getShortFileName = (target: string) => target.split(/[/\\]/).pop() || target;

interface Props {
    onTranscribeStart: () => void;
    onTranscribeEnd: (regions?: RegionTiming) => void;
}

const TranscribeControl: React.FC<Props> = ({
    onTranscribeStart,
    onTranscribeEnd,
}) => {
    const { isElectron } = useApp();
    const [lang, setLang] = useState('ru');
    const [model, setModel] = useState<'large_v3_turbo' | 'small' | 'base' | 'base_q'>('large_v3_turbo');
    const [maxContext, setMaxContext] = useState<number>(-1);
    const [maxLen, setMaxLen] = useState<number>(0);
    const [splitOnWord, setSplitOnWord] = useState<boolean>(false);
    const [useVad, setUseVad] = useState<boolean>(true);
    const [uiState, setUiState] = useAtom(appState.uiState);
    const setLog = useSetAtom(transcription.log);
    const [audioToTranscribe, setAudioToTranscribe] = useAtom(transcription.audioToTranscribe);
    const trimRange = useAtomValue(transcription.trimRange);

    const appendLog = (message: string) => {
        setLog((prev) => {
            const prefix = prev ? '\n' : '';
            const timestamp = new Date().toLocaleTimeString();

            return `${prev}${prefix}[${timestamp}] ${message}`;
        });
    };

    const handleStart = async () => {
        if (!isElectron) return;
        if (audioToTranscribe.length === 0) {
            appendLog('Не выбрано ни одного аудиофайла для распознавания.');

            return;
        }

        const segment: RegionTiming | undefined =
            trimRange?.start !== undefined &&
            trimRange?.end !== undefined &&
            trimRange.end > trimRange.start
                ? { start: trimRange.start, end: trimRange.end }
                : undefined;

        if (trimRange && !segment) {
            appendLog('Диапазон для обрезки задан некорректно. Отметьте начало и конец на плеере.');

            return;
        }

        onTranscribeStart();

        setUiState('transcribing');
        const targets = audioToTranscribe;
        let completed = false;

        try {
            for (const p of targets) {
                const fileName = getShortFileName(p);

                if (segment) {
                    appendLog(
                        `Распознаю фрагмент ${formatSeconds(segment.start)} — ${formatSeconds(segment.end)} файла ${fileName}`,
                    );
                } else {
                    appendLog(`Запускаю распознавание Whisper для ${fileName}`);
                }

                const startedAt = performance.now();

                await window.api!.transcribeStream(p, {
                    language: lang,
                    model,
                    maxContext,
                    maxLen,
                    splitOnWord,
                    useVad,
                    segment,
                });
                const durationMs = performance.now() - startedAt;

                appendLog(`Распознавание Whisper завершено для ${fileName}`);
                appendLog(`Обработано ${fileName}: ${formatDuration(durationMs)}.`);
            }
            completed = true;
        } catch (err) {
            appendLog(`Whisper завершился с ошибкой: ${formatErrorMessage(err)}`);
        } finally {
            onTranscribeEnd(completed ? segment : undefined);
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
            <Stack direction="row" spacing={1}>
                <Button
                    fullWidth={true}
                    variant="contained"
                    onClick={handleStart}
                    disabled={loading}
                    color="primary"
                    startIcon={loading ? <CircularProgress size={8} /> : <Earbuds  />}
                >
                    {'Распознать'}
                </Button>
                <IconButton onClick={handleStop} color="error" disabled={uiState !== 'transcribing'}>
                    <Stop />
                </IconButton>
                <Button variant="outlined" onClick={handleClear}>{'Сброс'}</Button>
            </Stack>

            <FormControl size="small">
                <InputLabel id="transcribe-model-label">{'Модель'}</InputLabel>
                <Select
                    labelId="transcribe-model-label"
                    label="Модель"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                >
                    <MenuItem value="tiny">{'Tiny'}</MenuItem>
                    <MenuItem value="base">{'Base'}</MenuItem>
                    <MenuItem value="small">{'Base сжатая'}</MenuItem>
                    <MenuItem value="small">{'Small'}</MenuItem>
                    <MenuItem value="large_v3_turbo">{'Large V3 turbo'}</MenuItem>
                </Select>
            </FormControl>

            <TranscribeAdvancedSettings
                maxContext={maxContext}
                onChangeMaxContext={setMaxContext}
                maxLen={maxLen}
                onChangeMaxLen={setMaxLen}
                splitOnWord={splitOnWord}
                onChangeSplitOnWord={setSplitOnWord}
                useVad={useVad}
                onChangeUseVad={setUseVad}
            />
        </Stack>
    );
};

export { TranscribeControl };
