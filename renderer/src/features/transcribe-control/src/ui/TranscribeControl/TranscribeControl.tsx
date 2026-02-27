import { ActionIcon, Box, Button, Checkbox, Group, Loader, Select, Stack, Text } from '@mantine/core';
import { IconHeadphones, IconPlayerStopFilled, IconBackspaceFilled } from '@tabler/icons-react';
import type { WhisperModelName } from 'electron/src/types/whisper';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import React, { useCallback, useMemo, useState } from 'react';
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
    const setRunOutcome = useSetAtom(transcription.runOutcome);
    const setRunErrorMessage = useSetAtom(transcription.runErrorMessage);
    const audioToTranscribe = useAtomValue(transcription.audioToTranscribe);
    const trimRange = useAtomValue(transcription.trimRange);
    const langData = useMemo(
        () => LANGS.map((langOption) => ({ value: langOption.code, label: langOption.label })),
        [],
    );

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

        setRunOutcome('none');
        setRunErrorMessage(null);
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
            setRunOutcome('success');
            setRunErrorMessage(null);
        } catch (err) {
            const message = formatErrorMessage(err);

            appendLog(`Whisper failed: ${message}`);
            setRunOutcome('error');
            setRunErrorMessage(message);
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
            setRunOutcome('none');
            setRunErrorMessage(null);
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
        <Stack gap={12} justify="space-between" h="100%">
            <Stack gap={12}>
                <Select
                    w="100%"
                    label="Language"
                    data={langData}
                    value={lang}
                    onChange={(value) => {
                        if (!value) return;
                        setLang(value);
                    }}
                />

                <WhisperModelSelect
                    value={model}
                    onChange={setModel}
                    onStatusChange={handleModelStatusChange}
                    onDownloadError={appendLog}
                    disabled={useCustomModelFile}
                />

                <Stack gap={8}>
                    <Checkbox
                        checked={useCustomModelFile}
                        onChange={(event) => setUseCustomModelFile(event.currentTarget.checked)}
                        label="Use a local model file"
                    />
                    {useCustomModelFile ? (
                        <Group gap={8} align="center" wrap="nowrap">
                            <Button
                                variant="outline"
                                onClick={handleImportCustomModel}
                                disabled={loading || isCustomModelImporting}
                            >
                                {'Choose file...'}
                            </Button>
                            <Text
                                size="xs"
                                c={customModelFile ? 'dimmed' : 'red'}
                                style={{ flexGrow: 1 }}
                            >
                                {customModelFile?.fileName ?? 'No file selected'}
                            </Text>
                            {customModelFile ? (
                                <Button
                                    variant="subtle"
                                    onClick={() => setCustomModelFile(null)}
                                    disabled={loading || isCustomModelImporting}
                                >
                                    {'Clear'}
                                </Button>
                            ) : null}
                        </Group>
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
            <Box>
                <Group gap={8} wrap="nowrap">
                    <Button
                        fullWidth={true}
                        onClick={handleStart}
                        disabled={loading || !canStart}
                        leftSection={loading ? <Loader size={12} /> : <IconHeadphones size={16} />}
                    >
                        {'Transcribe'}
                    </Button>
                    <ActionIcon onClick={handleStop} color="red" size={36} disabled={uiState !== 'transcribing'}>
                        <IconPlayerStopFilled size={20} />
                    </ActionIcon>
                    <ActionIcon onClick={handleClear} variant="light" size={36} disabled={uiState !== 'ready'}>
                        <IconBackspaceFilled size={20} />
                    </ActionIcon>
                </Group>
            </Box>
        </Stack>
    );
};

export { TranscribeControl };
