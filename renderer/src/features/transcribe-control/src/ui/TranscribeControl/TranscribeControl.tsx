import { ActionIcon, Alert, Box, Button, Checkbox, Group, Loader, Modal, Progress, Select, Stack, Switch, Text } from '@mantine/core';
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
    const [confirmReplaceSpeakers, setConfirmReplaceSpeakers] = useState(false);
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

    const handleStart = async (replaceSpeakerLabels = false) => {
        const result = await store.requestTranscriptionStart(replaceSpeakerLabels);
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

    const handlePrepareSpeakerComponent = async () => {
        const result = await store.prepareSpeakerAssets();
        if (!result.ok) appendLog(result.message);
    };

    const handleCancelSpeakerPreparation = async () => {
        const result = await store.stopSpeakerAnalysis();
        if (!result.ok) appendLog(result.message);
    };

    const isTranscribing = store.operations.kind === 'transcribing';
    const loading = isTranscribing || control.isDownloadingPendingModel;
    const canStart = !control.pendingDownloadModel
        && !store.operations.isBusy
        && (!store.whisperModels.isDownloadActive || useCustomModelFile || store.whisperModels.isDownloaded(model))
        && (!useCustomModelFile || Boolean(customModelFile));
    const hasSystemAudio = store.workspace.activeSession?.sourceKind === 'imported'
        || store.workspace.activeSession?.tracks?.some((track) => track.source === 'system');
    const preparingSpeakerAssets = store.operations.kind === 'preparing-speaker-assets';
    const canPrepareSpeakerComponent = store.speakers.enabled && hasSystemAudio && !store.speakers.componentReady;

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
                <Switch
                    checked={store.speakers.enabled}
                    disabled={store.operations.isBusy}
                    onChange={(event) => { void store.speakers.setEnabled(event.currentTarget.checked); }}
                    label="Add speaker labels after transcription"
                    description="Recognition is saved first. Speaker analysis can be retried separately."
                />
                {store.speakers.enabled && hasSystemAudio ? (
                    <Select label="Speaker analysis device" data={store.speakers.computeOptions}
                        value={store.speakers.compute} onChange={(value) => { void store.speakers.setCompute(value); }}
                        disabled={store.operations.isBusy}
                        description="Nemotron 3 counts speakers automatically. Auto uses CPU when no GPU is available." />
                ) : null}
                {store.speakers.enabled && hasSystemAudio && store.speakers.compute === 'gpu' && store.speakers.assets?.gpuAvailable === false ? (
                    <Alert color="yellow" title="GPU unavailable">Select CPU or update your graphics driver.</Alert>
                ) : null}
                {canPrepareSpeakerComponent ? (
                    <Stack gap={6}>
                        <Text size="xs" c="dimmed">Nemotron 3 runs locally. Its component is downloaded on first use; recognition is saved first.</Text>
                        {store.speakers.assets?.downloadBytes ? <Text size="xs">Download size: {(store.speakers.assets.downloadBytes / 1_000_000).toFixed(0)} MB</Text> : <Text size="xs">The release component is unavailable in this build.</Text>}
                        <Group gap={8}>
                            <Button size="compact-sm" variant="light" disabled={store.operations.isBusy} onClick={() => { void handlePrepareSpeakerComponent(); }}>
                                Prepare speaker component
                            </Button>
                            {preparingSpeakerAssets ? (
                                <Button size="compact-sm" color="red" variant="light" onClick={() => { void handleCancelSpeakerPreparation(); }}>Cancel</Button>
                            ) : null}
                        </Group>
                        {preparingSpeakerAssets ? (
                            <Group gap={8} wrap="nowrap" role="status">
                                <Text size="xs">{store.speakers.phase === 'downloading' ? 'Downloading speaker component' : 'Preparing speaker component'}</Text>
                                {store.speakers.phase === 'downloading' && store.speakers.totalBytes > 0 ? (
                                    <Progress value={100 * store.speakers.downloadedBytes / store.speakers.totalBytes} size="sm" style={{ flex: 1 }} />
                                ) : <Loader size="xs" />}
                            </Group>
                        ) : null}
                        {store.speakers.status === 'error' && store.speakers.errorMessage ? (
                            <Alert color="yellow" title="Component preparation failed">{store.speakers.errorMessage}</Alert>
                        ) : null}
                    </Stack>
                ) : null}
            </Stack>
            <Box>
                <Group gap={8} wrap="nowrap">
                    <Button
                        fullWidth={true}
                        onClick={() => {
                            if (store.transcription.savedTranscript?.speakers) setConfirmReplaceSpeakers(true);
                            else void handleStart();
                        }}
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
            <Modal opened={confirmReplaceSpeakers} onClose={() => setConfirmReplaceSpeakers(false)} title="Replace speaker labels?" centered={true}>
                <Stack gap="sm">
                    <Text size="sm">A new transcription will replace speaker names, assignments, and merges in this session.</Text>
                    <Group justify="flex-end">
                        <Button variant="default" onClick={() => setConfirmReplaceSpeakers(false)}>Cancel</Button>
                        <Button color="red" onClick={() => {
                            setConfirmReplaceSpeakers(false);
                            void handleStart(true);
                        }}>Replace and transcribe</Button>
                    </Group>
                </Stack>
            </Modal>
        </Stack>
    );
});

export { TranscribeControl };
