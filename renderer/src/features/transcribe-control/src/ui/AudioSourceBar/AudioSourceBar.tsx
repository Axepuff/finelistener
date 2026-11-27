import { Box, Button, Group, Modal, Stack, Text } from '@mantine/core';
import { IconFileMusic, IconHeadphones } from '@tabler/icons-react';
import { observer } from 'mobx-react-lite';
import React, { useId, useState } from 'react';
import { useAppStore } from '../../../../../AppContext';
import './AudioSourceBar.css';

export const AudioSourceBar: React.FC = observer(() => {
    const store = useAppStore();
    const { operations, transcriptionControl, whisperModels, workspace } = store;
    const [confirmReplaceSpeakers, setConfirmReplaceSpeakers] = useState(false);
    const statusId = useId();
    const session = workspace.activeSession;
    const info = session?.sourceMetadata;
    const seconds = info?.durationMs !== undefined ? Math.floor(info.durationMs / 1000) : null;
    const metadata = [
        seconds !== null ? `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : null,
        info?.sampleRate ? `${info.sampleRate / 1000} kHz` : null,
        info?.channels ? info.channels === 1 ? 'mono' : info.channels === 2 ? 'stereo' : `${info.channels} channels` : null,
    ].filter(Boolean).join(' · ');
    const fileName = session?.sourceFileName ?? session?.audioOriginalPath.split(/[/\\]/).pop();

    const { model, useCustomModelFile, customModelFile } = transcriptionControl;
    const modelReady = useCustomModelFile ? Boolean(customModelFile) : whisperModels.isDownloaded(model);
    const downloadingSelectedModel = !useCustomModelFile && whisperModels.downloadProgress?.name === model;
    const modelName = model[0].toUpperCase() + model.slice(1);
    const canUseBase = downloadingSelectedModel && model !== 'base' && whisperModels.isDownloaded('base');
    const showStart = operations.kind !== 'transcribing' && operations.kind !== 'analyzing-speakers';
    const blockReason = store.operationBlockReason ??
        (
        !workspace.hasAudioSource ? 'Choose an audio source to transcribe.' :
        workspace.hasIncompleteSegment ? 'Complete or clear the selected segment.' :
        !modelReady ? (useCustomModelFile ? 'Choose a local model file to transcribe.' :
            downloadingSelectedModel ? `${modelName} can transcribe once it is downloaded.${canUseBase ? ' You can start now with Base or wait.' : ''}` :
            'Download the selected model to transcribe.') : null);

    const handleReplace = async () => {
        const result = await store.importAudio();
        if (!result.ok) store.activityLog.appendEvent(result.message);
    };

    const handleStart = async (replaceSpeakerLabels = false) => {
        const result = await store.requestTranscriptionStart(replaceSpeakerLabels);
        if (!result.ok) store.activityLog.appendEvent(result.message);
    };

    return (
        <Group className="audio-source-bar" gap={12}>
            <Group className="audio-source-bar__source" gap={8} wrap="nowrap">
                <Box className="audio-source-bar__icon"><IconFileMusic size={18} aria-hidden="true" /></Box>
                <Stack gap={0} className="audio-source-bar__file">
                    <Text size="sm" fw={600} truncate="end" title={fileName}>{fileName ?? 'No source selected'}</Text>
                    <Text size="xs" c="dimmed" ff="var(--brand-font-family-code)">{metadata || 'Source details unavailable'}</Text>
                </Stack>
                <Button variant="default" size="xs" disabled={operations.isBusy} title={store.operationBlockReason} aria-description={store.operationBlockReason}
                    className="audio-source-bar__replace" onClick={() => void handleReplace()}>Replace</Button>
            </Group>
            {showStart ? (
                <Group gap={8} justify="flex-end" className="audio-source-bar__actions">
                    <Text id={statusId} size="xs" c="dimmed" aria-live="polite" className="audio-source-bar__status">{blockReason}</Text>
                    {canUseBase ? (
                        <Button variant="default" onClick={() => transcriptionControl.setModel('base')}>Use Base now</Button>
                    ) : null}
                    <Button
                        onClick={() => {
                            if (store.transcription.savedTranscript?.speakers) setConfirmReplaceSpeakers(true);
                            else void handleStart();
                        }}
                        disabled={blockReason !== null}
                        aria-describedby={blockReason ? statusId : undefined}
                        leftSection={<IconHeadphones size={16} aria-hidden="true" />}
                    >
                        {downloadingSelectedModel ? `Transcribe with ${modelName}` :
                            workspace.selectedSegment ? 'Transcribe segment' : 'Transcribe'}
                    </Button>
                </Group>
            ) : null}
            <Modal opened={confirmReplaceSpeakers} onClose={() => setConfirmReplaceSpeakers(false)} title="Replace speaker labels?" centered={true}>
                <Stack gap="sm">
                    <Text size="sm">A new transcription will replace speaker names, assignments, and merges in this session.</Text>
                    <Group justify="flex-end">
                        <Button variant="default" onClick={() => setConfirmReplaceSpeakers(false)}>Cancel</Button>
                        <Button color="red" disabled={operations.isBusy} title={store.operationBlockReason} aria-description={store.operationBlockReason} onClick={() => {
                            setConfirmReplaceSpeakers(false);
                            void handleStart(true);
                        }}>Replace and transcribe</Button>
                    </Group>
                </Stack>
            </Modal>
        </Group>
    );
});
