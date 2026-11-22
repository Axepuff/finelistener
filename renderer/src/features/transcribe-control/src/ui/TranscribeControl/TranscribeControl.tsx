import { ActionIcon, Alert, Box, Button, Group, Loader, Modal, Progress, Select, Stack, Switch, Text } from '@mantine/core';
import { IconHeadphones, IconTrash } from '@tabler/icons-react';
import { observer } from 'mobx-react-lite';
import React, { useCallback, useState } from 'react';
import { useAppStore } from '../../../../../AppContext';
import { TranscribeAdvancedSettings } from '../TranscribeAdvancedSettings/TranscribeAdvancedSettings';
import { TranscriptionProgress } from './TranscriptionProgress';
import { SourceCard } from './SourceCard';
import { RecordingSettings } from './RecordingSettings';
import './Settings.css';
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
                control.setUseCustomModelFile(true);
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

    const showProgress = store.operations.kind === 'transcribing' || store.operations.kind === 'analyzing-speakers';
    const modelReady = useCustomModelFile ? Boolean(customModelFile) : store.whisperModels.isDownloaded(model);
    const blockReason = store.operations.kind === 'recording' ? 'Stop recording to transcribe.' : store.operationBlockReason ??
        (
        !store.workspace.hasAudioSource ? 'Choose an audio source to transcribe.' :
        store.workspace.hasIncompleteSegment ? 'Complete or clear the selected segment.' :
        !modelReady ? (useCustomModelFile ? 'Choose a local model file to transcribe.' :
            store.whisperModels.downloadProgress?.name === model ? 'The selected model is downloading.' :
            'Download the selected model to transcribe.') : null);
    const canStart = blockReason === null;
    const hasSystemAudio = store.workspace.activeSession?.sourceKind === 'imported'
        || store.workspace.activeSession?.tracks?.some((track) => track.source === 'system');
    const preparingSpeakerAssets = store.operations.kind === 'preparing-speaker-assets';
    const canPrepareSpeakerComponent = store.speakers.enabled && hasSystemAudio && !store.speakers.componentReady;

    if (showProgress) return <TranscriptionProgress />;

    return (
        <Box className="settings-panel">
            <Stack gap={20} className="settings-panel__scroll">
                <Text component="h2" size="lg" fw={600} m={0}>Settings</Text>
                {!store.recordingInProgress ? <SourceCard /> : <Text size="xs" c="dimmed">These settings apply to the next transcription.</Text>}
                <RecordingSettings />
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
                    value={useCustomModelFile ? null : model}
                    onChange={(value) => { control.setModel(value); control.setUseCustomModelFile(false); }}
                />

                <Stack gap={8}>
                    <Button variant="subtle" className="settings-link" size="compact-xs" onClick={() => { void handleImportCustomModel(); }} disabled={isCustomModelImporting}>
                        Use a local model file instead
                    </Button>
                    {useCustomModelFile ? (
                        <Group gap={8} align="center">
                            <Button
                                variant="outline"
                                onClick={handleImportCustomModel}
                                disabled={isCustomModelImporting}
                            >
                                {'Choose file...'}
                            </Button>
                            <Text
                                size="xs"
                                c={customModelFile ? 'dimmed' : 'red'}
                                style={{ flexGrow: 1, minWidth: 0, overflowWrap: 'anywhere' }}
                            >
                                {customModelFile?.fileName ?? 'No file selected'}
                            </Text>
                            {customModelFile ? (
                                <Button
                                    variant="subtle"
                                    onClick={() => control.setCustomModelFile(null)}
                                    disabled={isCustomModelImporting}
                                >
                                    {'Clear'}
                                </Button>
                            ) : null}
                        </Group>
                    ) : null}
                </Stack>

                <Switch
                    checked={store.speakers.enabled}
                    disabled={store.operations.isBusy && !store.recordingInProgress}
                    onChange={(event) => { void store.speakers.setEnabled(event.currentTarget.checked); }}
                    label="Identify speakers"
                    description="Runs after transcription. The transcript is saved first."
                    className="settings-speakers"
                />
                {store.speakers.enabled ? (
                    <Select label="Speaker analysis device" data={store.speakers.computeOptions}
                        value={store.speakers.compute} onChange={(value) => { void store.speakers.setCompute(value); }}
                        disabled={store.operations.isBusy && !store.recordingInProgress}
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
                            <Button size="compact-sm" variant="light" disabled={store.operations.isBusy} title={store.operationBlockReason} aria-description={store.operationBlockReason} onClick={() => { void handlePrepareSpeakerComponent(); }}>
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
            <Box className="settings-panel__footer">
                <Text id="settings-transcription-status" size="xs" c="dimmed" aria-live="polite">{blockReason ?? 'Ready to transcribe.'}</Text>
                <Group gap={8} wrap="nowrap">
                    <Button
                        fullWidth={true}
                        onClick={() => {
                            if (store.transcription.savedTranscript?.speakers) setConfirmReplaceSpeakers(true);
                            else void handleStart();
                        }}
                        disabled={!canStart}
                        aria-describedby="settings-transcription-status"
                        leftSection={<IconHeadphones size={16} />}
                    >
                        {!store.recordingInProgress && store.workspace.selectedSegment ? 'Transcribe segment' : 'Transcribe'}
                    </Button>
                    <ActionIcon onClick={handleClear} aria-label="Clear workspace" title={store.operations.isBusy ? blockReason ?? undefined : 'Clear workspace'}
                        aria-describedby={store.operations.isBusy ? 'settings-transcription-status' : undefined}
                        variant="default" size={32} disabled={store.operations.isBusy || store.lifecycleState !== 'ready'}>
                        <IconTrash size={20} />
                    </ActionIcon>
                </Group>
            </Box>
            <Modal opened={confirmReplaceSpeakers} onClose={() => setConfirmReplaceSpeakers(false)} title="Replace speaker labels?" centered={true}>
                <Stack gap="sm">
                    <Text size="sm">A new transcription will replace speaker names, assignments, and merges in this session.</Text>
                    <Group justify="flex-end">
                        <Button variant="default" onClick={() => setConfirmReplaceSpeakers(false)}>Cancel</Button>
                        <Button color="red" disabled={store.operations.isBusy} title={store.operationBlockReason} aria-description={store.operationBlockReason} onClick={() => {
                            setConfirmReplaceSpeakers(false);
                            void handleStart(true);
                        }}>Replace and transcribe</Button>
                    </Group>
                </Stack>
            </Modal>
        </Box>
    );
});

export { TranscribeControl };
