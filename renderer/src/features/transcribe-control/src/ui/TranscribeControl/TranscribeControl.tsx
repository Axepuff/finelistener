import { Earbuds, Stop } from '@mui/icons-material';
import {
    Button,
    Checkbox,
    CircularProgress,
    FormControl,
    FormControlLabel,
    IconButton,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    Typography,
} from '@mui/material';
import type { WhisperModelName } from 'electron/src/types/whisper';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import React, { useCallback, useState } from 'react';
import { atoms, type RegionTiming } from 'renderer/src/atoms';
import { useApp } from '../../../../../AppContext';
import { TranscribeAdvancedSettings } from '../TranscribeAdvancedSettings/TranscribeAdvancedSettings';
import { WhisperModelSelect } from '../WhisperModelSelect/WhisperModelSelect';

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

const formatDuration = (ms: number): string => {
    if (!Number.isFinite(ms) || ms < 0) return '0 s';

    const totalSeconds = ms / 1000;

    if (totalSeconds < 60) return `${totalSeconds.toFixed(1)} s`;

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds - minutes * 60;

    return `${minutes} min ${seconds.toFixed(1)} s`;
};

const formatSeconds = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0 s';

    return `${seconds.toFixed(2)} s`;
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
    const [model, setModel] = useState<WhisperModelName>('large');
    const [isModelDownloaded, setIsModelDownloaded] = useState(false);
    const [isModelDownloadActive, setIsModelDownloadActive] = useState(false);
    const [useCustomModelFile, setUseCustomModelFile] = useState(false);
    const [customModelFile, setCustomModelFile] = useState<{ path: string; fileName: string } | null>(null);
    const [isCustomModelImporting, setIsCustomModelImporting] = useState(false);
    const [maxContext, setMaxContext] = useState<number | null>(null);
    const [maxLen, setMaxLen] = useState<number | null>(null);
    const [splitOnWord, setSplitOnWord] = useState<boolean>(true);
    const [useVad, setUseVad] = useState<boolean>(true);
    const [uiState, setUiState] = useAtom(appState.uiState);
    const setLog = useSetAtom(transcription.log);
    const audioToTranscribe = useAtomValue(transcription.audioToTranscribe);
    const trimRange = useAtomValue(transcription.trimRange);

    const appendLog = useCallback((message: string) => {
        setLog((prev) => {
            const prefix = prev ? '\n' : '';
            const timestamp = new Date().toLocaleTimeString();

            return `${prev}${prefix}[${timestamp}] ${message}`;
        });
    }, [setLog]);

    const handleModelStatusChange = useCallback(
        (status: { isModelDownloaded: boolean; isDownloadActive: boolean }) => {
            setIsModelDownloaded(status.isModelDownloaded);
            setIsModelDownloadActive(status.isDownloadActive);
        },
        [],
    );

    const handleImportCustomModel = useCallback(async () => {
        if (!window.api?.importWhisperModelFromFile) {
            appendLog('Custom model import is not available in this build.');

            return;
        }

        setIsCustomModelImporting(true);

        try {
            const result = await window.api.importWhisperModelFromFile();

            if (!result) return;

            if (!result.ok) {
                appendLog(`Failed to import model: ${result.error}`);

                return;
            }

            setCustomModelFile({ path: result.path, fileName: result.fileName });
            appendLog(`Imported model file: ${result.fileName}`);
        } catch (err) {
            console.error('Failed to import custom model', err);
            appendLog(`Failed to import model: ${formatErrorMessage(err)}`);
        } finally {
            setIsCustomModelImporting(false);
        }
    }, [appendLog]);

    const handleStart = async () => {
        if (!isElectron || !canStart) return;
        if (useCustomModelFile && !customModelFile) {
            appendLog('No custom model file selected.');

            return;
        }
        if (audioToTranscribe.length === 0) {
            appendLog('No audio files selected for transcription.');

            return;
        }

        const segment: RegionTiming | undefined =
            trimRange?.start !== undefined &&
            trimRange?.end !== undefined &&
            trimRange.end > trimRange.start
                ? { start: trimRange.start, end: trimRange.end }
                : undefined;

        if (trimRange && !segment) {
            appendLog('Invalid trim range. Please set the start and end positions in the player.');

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
                        `Transcribing segment ${formatSeconds(segment.start)} — ${formatSeconds(segment.end)} of ${fileName}`,
                    );
                } else {
                    appendLog(`Starting Whisper transcription for ${fileName}`);
                }

                const startedAt = performance.now();

                await window.api!.transcribeStream(p, {
                    language: lang,
                    model,
                    modelPath: useCustomModelFile ? customModelFile?.path : undefined,
                    maxContext: maxContext ?? -1,
                    maxLen: maxLen ?? 0,
                    splitOnWord,
                    useVad,
                    segment,
                });
                const durationMs = performance.now() - startedAt;

                appendLog(`Whisper transcription finished for ${fileName}`);
                appendLog(`Processed ${fileName}: ${formatDuration(durationMs)}.`);
            }
            completed = true;
        } catch (err) {
            appendLog(`Whisper failed: ${formatErrorMessage(err)}`);
        } finally {
            onTranscribeEnd(completed ? segment : undefined);
            setUiState('ready');
        }
    };

    const handleStop = async () => {
        try {
            const stopped = await window.api!.stopTranscription();

            if (stopped) {
                appendLog('Transcription stopped.');
            } else {
                appendLog('No transcription is running.');
            }
        } catch (err: unknown) {
            appendLog(`Failed to stop Whisper: ${formatErrorMessage(err)}`);
        } finally {
            setUiState('ready');
        }
    };

    const resetTranscriptionState = useSetAtom(atoms.reset);

    const handleClear = () => {
        resetTranscriptionState();
    };

    const loading = uiState === 'transcribing';
    const canStart = !isModelDownloadActive && (useCustomModelFile ? Boolean(customModelFile) : isModelDownloaded);

    return (
        <Stack spacing={2}>
            <FormControl size="small" sx={{ minWidth: 160 }}>
                <InputLabel id="lang-label">{'Language'}</InputLabel>
                <Select
                    labelId="lang-label"
                    label="Talking language"
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
                    disabled={loading || !canStart}
                    color="primary"
                    startIcon={loading ? <CircularProgress size={8} /> : <Earbuds />}
                >
                    {'Transcribe'}
                </Button>
                <IconButton onClick={handleStop} color="error" disabled={uiState !== 'transcribing'}>
                    <Stop />
                </IconButton>
                <Button variant="outlined" onClick={handleClear}>{'Reset'}</Button>
            </Stack>

            <WhisperModelSelect
                value={model}
                onChange={setModel}
                onStatusChange={handleModelStatusChange}
                onDownloadError={appendLog}
                disabled={useCustomModelFile}
            />

            <Stack spacing={0.75}>
                <FormControlLabel
                    control={(
                        <Checkbox
                            checked={useCustomModelFile}
                            onChange={(e) => setUseCustomModelFile(e.target.checked)}
                        />
                    )}
                    label="Use a local model file"
                />
                {useCustomModelFile ? (
                    <Stack direction="row" spacing={1} alignItems="center">
                        <Button
                            variant="outlined"
                            size="small"
                            onClick={handleImportCustomModel}
                            disabled={loading || isCustomModelImporting}
                        >
                            {'Choose file…'}
                        </Button>
                        <Typography
                            variant="caption"
                            color={customModelFile ? 'text.secondary' : 'error'}
                            sx={{ flexGrow: 1 }}
                        >
                            {customModelFile?.fileName ?? 'No file selected'}
                        </Typography>
                        {customModelFile ? (
                            <Button
                                variant="text"
                                size="small"
                                onClick={() => setCustomModelFile(null)}
                                disabled={loading || isCustomModelImporting}
                            >
                                {'Clear'}
                            </Button>
                        ) : null}
                    </Stack>
                ) : null}
            </Stack>

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
