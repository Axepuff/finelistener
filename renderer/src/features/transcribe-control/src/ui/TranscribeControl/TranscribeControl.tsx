import { ActionIcon, Box, Button, Checkbox, Group, Loader, Select, Stack, Text } from '@mantine/core';
import { IconHeadphones, IconPlayerStopFilled, IconBackspaceFilled } from '@tabler/icons-react';
import { observer } from 'mobx-react-lite';
import React, { useCallback, useState } from 'react';
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

const langData = LANGS.map(({ code, label }) => ({ value: code, label }));

const TranscribeControl: React.FC = observer(() => {
    const store = useAppStore();
    const control = store.transcriptionControl;
    const [isCustomModelImporting, setIsCustomModelImporting] = useState(false);
    const { language: lang, model, useCustomModelFile, customModelFile, maxContext, maxLen, splitOnWord, useVad, microphoneGateEnabled } = control;

    const appendLog = useCallback((message: string) => {
        store.activityLog.appendEvent(message);
    }, [store]);

    const handleImportCustomModel = async () => {
        if (isCustomModelImporting) return;
        setIsCustomModelImporting(true);
        try {
            const result = await store.whisperModels.importCustomModel();
            if (!result.ok) {
                appendLog(result.message);
            } else if (result.value) {
                control.setCustomModelFile(result.value);
                appendLog(`Imported model file: ${result.value.fileName}`);
            }
        } finally {
            setIsCustomModelImporting(false);
        }
    };

    const handleStart = async () => {
        const result = await store.requestTranscriptionStart();
        if (!result.ok) appendLog(result.message);
    };

    const handleStop = async () => {
        const result = await store.stopTranscription();
        if (!result.ok) appendLog(result.message);
    };

    const handleClear = () => {
        const result = store.clearWorkspace();
        if (!result.ok) appendLog(result.message);
    };

    const isTranscribing = store.operations.kind === 'transcribing';
    const loading = isTranscribing || control.isDownloadingPendingModel;
    const canStart = !control.pendingDownloadModel
        && !store.operations.isBusy
        && (!store.whisperModels.isDownloadActive || useCustomModelFile || store.whisperModels.isDownloaded(model))
        && (!useCustomModelFile || Boolean(customModelFile));

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
                        control.setLanguage(value);
                    }}
                />

                <WhisperModelSelect
                    value={model}
                    onChange={(value) => control.setModel(value)}
                    onDownloadError={appendLog}
                    disabled={useCustomModelFile}
                />

                <Stack gap={8}>
                    <Checkbox
                        checked={useCustomModelFile}
                        onChange={(event) => control.setUseCustomModelFile(event.currentTarget.checked)}
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
                                    onClick={() => control.setCustomModelFile(null)}
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
                    onChangeMaxContext={(value) => control.setMaxContext(value)}
                    maxLen={maxLen}
                    onChangeMaxLen={(value) => control.setMaxLen(value)}
                    splitOnWord={splitOnWord}
                    onChangeSplitOnWord={(value) => control.setSplitOnWord(value)}
                    useVad={useVad}
                    onChangeUseVad={(value) => control.setUseVad(value)}
                    microphoneGateEnabled={microphoneGateEnabled}
                    onChangeMicrophoneGateEnabled={(value) => control.setMicrophoneGateEnabled(value)}
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
                    <ActionIcon onClick={handleStop} color="red" size={36} disabled={!isTranscribing}>
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
