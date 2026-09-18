import { ActionIcon, Box, Button, Checkbox, Group, Loader, Select, Stack, Text } from '@mantine/core';
import { IconHeadphones, IconPlayerStopFilled, IconBackspaceFilled } from '@tabler/icons-react';
import type { WhisperModelName } from 'electron/src/types/whisper';
import { observer } from 'mobx-react-lite';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../../../../AppContext';
import { TranscribeAdvancedSettings } from '../TranscribeAdvancedSettings/TranscribeAdvancedSettings';
import { WhisperModelSelect } from '../WhisperModelSelect/WhisperModelSelect';

const LANGS = [
    { code: 'auto', label: 'Auto' },
    { code: 'en', label: 'English' },
    { code: 'ru', label: 'Russian' },
    { code: 'es', label: 'Spanish' },
    { code: 'de', label: 'German' },
    { code: 'fr', label: 'French' },
];

type TranscribePhase = 'idle' | 'awaiting-download' | 'downloading' | 'transcribing';

const TranscribeControl: React.FC = observer(() => {
    const store = useAppStore();
    const [lang, setLang] = useState('ru');
    const [model, setModel] = useState<WhisperModelName>('large');
    const [isModelDownloaded, setIsModelDownloaded] = useState(false);
    const [phase, setPhase] = useState<TranscribePhase>('idle');
    const [useCustomModelFile, setUseCustomModelFile] = useState(false);
    const [customModelFile, setCustomModelFile] = useState<{ path: string; fileName: string } | null>(null);
    const [isCustomModelImporting, setIsCustomModelImporting] = useState(false);
    const [maxContext, setMaxContext] = useState<number | null>(null);
    const [maxLen, setMaxLen] = useState<number | null>(null);
    const [splitOnWord, setSplitOnWord] = useState<boolean>(true);
    const [useVad, setUseVad] = useState<boolean>(true);
    const startAttemptIdRef = useRef(0);
    const langData = useMemo(
        () => LANGS.map((langOption) => ({ value: langOption.code, label: langOption.label })),
        [],
    );

    const appendLog = useCallback((message: string) => {
        store.activityLog.appendEvent(message);
    }, [store]);

    const handleModelStatusChange = useCallback(
        (status: { isModelDownloaded: boolean; isDownloadActive: boolean }) => {
            setIsModelDownloaded(status.isModelDownloaded);
            if (status.isDownloadActive) {
                setPhase((prev) => (prev === 'awaiting-download' ? 'downloading' : prev));
            } else if (!status.isModelDownloaded) {
                setPhase((prev) => (prev === 'downloading' ? 'idle' : prev));
            }
        },
        [],
    );

    useEffect(() => {
        if (phase === 'downloading' && isModelDownloaded) {
            setPhase('idle');
            handleStartRef.current?.();
        }
    }, [phase, isModelDownloaded]);

    const handleImportCustomModel = useCallback(async () => {
        setIsCustomModelImporting(true);

        try {
            const result = await store.importCustomModel();

            if (!result.ok) {
                appendLog(result.message);

                return;
            }

            if (result.value) {
                setCustomModelFile(result.value);
                appendLog(`Imported model file: ${result.value.fileName}`);
            }
        } finally {
            setIsCustomModelImporting(false);
        }
    }, [appendLog, store]);

    const handleStartRef = useRef<(() => void) | undefined>(undefined);

    const handleStart = async () => {
        if (useCustomModelFile && !customModelFile) {
            appendLog('No custom model file selected.');

            return;
        }
        if (!useCustomModelFile && !isModelDownloaded) {
            setPhase('awaiting-download');

            return;
        }

        setPhase('transcribing');
        const attemptId = startAttemptIdRef.current + 1;

        startAttemptIdRef.current = attemptId;
        const result = await store.startTranscription({
            language: lang,
            model,
            modelPath: useCustomModelFile ? customModelFile?.path : undefined,
            maxContext: maxContext ?? undefined,
            maxLen: maxLen ?? undefined,
            splitOnWord,
            useVad,
        });

        if (startAttemptIdRef.current === attemptId) {
            setPhase('idle');

            if (!result.ok) {
                appendLog(result.message);
            }
        }
    };

    handleStartRef.current = handleStart;

    const handleDownloadComplete = useCallback(() => {
        // Phase transition and auto-start handled by handleModelStatusChange + effect
    }, []);

    const handleDownloadCancelled = useCallback(() => {
        setPhase('idle');
    }, []);

    const handleStop = async () => {
        startAttemptIdRef.current += 1;
        const result = await store.stopTranscription();

        setPhase('idle');
        if (!result.ok) {
            appendLog(result.message);
        }
    };

    const handleClear = () => {
        const result = store.clearWorkspace();

        if (!result.ok) {
            appendLog(result.message);
        }
    };

    const loading = phase === 'transcribing' || phase === 'downloading';
    const canStart = phase === 'idle'
        && !store.operations.isBusy
        && (useCustomModelFile ? Boolean(customModelFile) : true);

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
                    requestDownload={phase === 'awaiting-download'}
                    onDownloadComplete={handleDownloadComplete}
                    onDownloadCancelled={handleDownloadCancelled}
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
                    <ActionIcon onClick={handleStop} color="red" size={36} disabled={phase !== 'transcribing'}>
                        <IconPlayerStopFilled size={20} />
                    </ActionIcon>
                    <ActionIcon onClick={handleClear} variant="light" size={36} disabled={store.lifecycleState !== 'ready'}>
                        <IconBackspaceFilled size={20} />
                    </ActionIcon>
                </Group>
            </Box>
        </Stack>
    );
});

export { TranscribeControl };
