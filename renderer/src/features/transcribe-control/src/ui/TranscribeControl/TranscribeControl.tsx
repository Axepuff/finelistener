import { TranscriptionError } from './TranscriptionError';
import { InlineAlert } from 'renderer/src/shared/InlineAlert';
import { ActionIcon, Box, Button, Checkbox, Group, Loader, Progress, Select, Stack, Switch, Text } from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import { observer } from 'mobx-react-lite';
import React, { useCallback, useState } from 'react';
import { useAppStore } from '../../../../../AppContext';
import { AudioSourceBar } from '../AudioSourceBar/AudioSourceBar';
import { TranscribeAdvancedSettings } from '../TranscribeAdvancedSettings/TranscribeAdvancedSettings';
import { TranscriptionProgress } from './TranscriptionProgress';
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
    const hasSystemAudio = store.workspace.activeSession?.sourceKind === 'imported'
        || store.workspace.activeSession?.tracks?.some((track) => track.source === 'system');
    const preparingSpeakerAssets = store.operations.kind === 'preparing-speaker-assets';
    const hasTranscript = Boolean(store.transcription.savedTranscript?.segments.length);
    const canPrepareSpeakerComponent = hasSystemAudio && !store.speakers.componentReady
        && (preparingSpeakerAssets || store.speakers.enabled || (hasTranscript && store.speakers.status === 'error'));

    if (showProgress) return <TranscriptionProgress />;

    return (
        <Box className="settings-panel">
            {!store.recordingInProgress ? <AudioSourceBar /> : null}
            <Stack gap={20} className="settings-panel__scroll">
                <Text component="h2" size="lg" fw={600} m={0}>Settings</Text>
                {store.recordingInProgress ? <Text size="xs" c="dimmed">These settings apply to the next transcription.</Text> : null}
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
                {hasTranscript && store.speakers.status === 'cancelled' ? (
                    <Text size="xs" c="dimmed" role="status">Identify speakers · Skipped. You can run speaker analysis from Speakers.</Text>
                ) : null}
                {store.speakers.enabled && hasSystemAudio && store.speakers.compute === 'gpu' && store.speakers.assets?.gpuAvailable === false ? (
                    <InlineAlert severity="warning" title="GPU unavailable" actions={<Button size="compact-sm" disabled={store.operations.isBusy} onClick={() => { void store.speakers.setCompute('cpu'); }}>Select CPU</Button>}>Select CPU or update your graphics driver.</InlineAlert>
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
                                <Button size="compact-sm" variant="default" onClick={() => { void handleCancelSpeakerPreparation(); }}>
                                    {hasTranscript ? 'Skip speakers' : 'Cancel'}
                                </Button>
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
                            <InlineAlert title="Component preparation failed" actions={<Group gap={6}>
                                <Button size="compact-sm" disabled={store.operations.isBusy} onClick={() => { void handlePrepareSpeakerComponent(); }}>Retry download</Button>
                                {hasTranscript ? <Button size="compact-sm" variant="default" disabled={store.operations.isBusy} onClick={() => store.speakers.cancel()}>Skip speakers</Button> : null}
                            </Group>}>{store.speakers.errorMessage}</InlineAlert>
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
                <TranscriptionError />
            </Stack>
            <Box className="settings-panel__footer">
                <Group gap={8} justify="space-between" wrap="nowrap">
                    {store.operations.kind === 'recording' ? (
                        <Checkbox label="Transcribe when recording stops"
                            checked={store.recording.transcribeWhenRecordingStops}
                            onChange={(event) => void store.recording.setTranscribeWhenRecordingStops(event.currentTarget.checked)} />
                    ) : null}
                    <ActionIcon onClick={handleClear} aria-label="Clear workspace" title={store.operationBlockReason ?? 'Clear workspace'}
                        aria-description={store.operationBlockReason} variant="default" size={32}
                        className="settings-panel__clear" disabled={store.operations.isBusy || store.lifecycleState !== 'ready'}>
                        <IconTrash size={20} />
                    </ActionIcon>
                </Group>
            </Box>
        </Box>
    );
});

export { TranscribeControl };
