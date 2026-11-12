import type { SessionSpeakerAssignment } from 'electron/src/types/sessions';
import { ActionIcon, Alert, Button, Divider, Group, Loader, Modal, NumberInput, Popover, Progress, Select, Stack, Text, TextInput } from '@mantine/core';
import { IconArrowMerge, IconPencil, IconRefresh, IconSettings } from '@tabler/icons-react';
import { observer } from 'mobx-react-lite';
import React, { useState } from 'react';
import { useAppStore } from 'renderer/src/AppContext';
import type { CommandResult } from 'renderer/src/stores/types';

interface Props {
    selectedSpan: SessionSpeakerAssignment | null;
    onCloseSpan: () => void;
}

const phaseLabels = {
    preparing: 'Preparing speaker analysis',
    downloading: 'Downloading speaker analysis components',
    converting: 'Preparing audio',
    analyzing: 'Analyzing speakers',
    saving: 'Saving speaker labels',
    fallback: 'Switching to CPU analysis',
};

export const SpeakerControls: React.FC<Props> = observer(({ selectedSpan, onCloseSpan }) => {
    const store = useAppStore();
    const speakerState = store.speakers;
    const transcript = store.transcription.savedTranscript;
    const speakers = transcript?.speakers?.speakers ?? [];
    const hasSpeakers = Boolean(transcript?.speakers);
    const isBusy = store.operations.isBusy;
    const [settingsOpened, setSettingsOpened] = useState(false);
    const [confirmRerun, setConfirmRerun] = useState(false);
    const [renameId, setRenameId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [mergeSourceId, setMergeSourceId] = useState<string | null>(null);
    const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);
    const [assignId, setAssignId] = useState<string | null>(null);
    const [editPending, setEditPending] = useState<'rename' | 'merge' | 'assign' | null>(null);
    const [editError, setEditError] = useState<string | null>(null);

    if (!store.workspace.activeSessionId || !transcript?.segments.length) return null;

    const options = speakers.map((speaker) => ({ value: speaker.id, label: speaker.name }));
    const hasSystemAudio = store.workspace.activeSession?.sourceKind === 'imported'
        || store.workspace.activeSession?.tracks?.some((track) => track.source === 'system');
    const assignmentOptions = [{ value: '__unknown__', label: 'Unknown speaker' }, ...options];
    const selectedSegment = selectedSpan ? transcript.segments.find((segment) =>
        segment.rawSpan?.segmentId === selectedSpan.spans[0]?.segmentId
        && segment.rawSpan?.startChar === selectedSpan.spans[0]?.startChar
        && segment.rawSpan?.endChar === selectedSpan.spans[0]?.endChar) : null;
    const execute = async (action: Promise<{ ok: true; value: void } | { ok: false; message: string }>) => {
        const result = await action;
        if (!result.ok) store.activityLog.appendEvent(result.message);
    };
    const saveEdit = async (kind: 'rename' | 'merge' | 'assign', action: Promise<CommandResult>, onSuccess: () => void) => {
        setEditPending(kind);
        setEditError(null);
        try {
            const result = await action;
            if (result.ok) onSuccess();
            else setEditError(result.message);
        } catch (error: unknown) {
            console.error('Failed to save speaker edit', error);
            setEditError('Speaker labels could not be updated.');
        } finally {
            setEditPending(null);
        }
    };
    const start = () => {
        setSettingsOpened(false);
        if (hasSpeakers) setConfirmRerun(true);
        else void execute(store.analyzeSpeakers());
    };

    return (
        <>
            <Popover opened={settingsOpened} onChange={setSettingsOpened} width={260} position="bottom-end" shadow="md" trapFocus={true}>
                <Popover.Target>
                    <ActionIcon size={30} variant={settingsOpened ? 'light' : 'subtle'} color="gray" aria-label="Speaker settings" title="Speaker settings" onClick={() => setSettingsOpened((opened) => !opened)} style={{ flexShrink: 0 }}>
                        <IconSettings size={17} />
                    </ActionIcon>
                </Popover.Target>
                <Popover.Dropdown p={12}>
                    <Stack gap={8}>
                        {hasSystemAudio ? (
                            <>
                                {speakerState.assets?.engine === 'nemotron-3' ? (
                                    <Text size="xs" c="dimmed">Nemotron counts speakers automatically. Exact counts are unavailable.</Text>
                                ) : <NumberInput
                                    label="Speaker count"
                                    placeholder="Auto"
                                    description={store.workspace.activeSession?.tracks?.some((track) => track.source === 'microphone') ? 'Excludes the microphone speaker.' : undefined}
                                    min={1}
                                    allowDecimal={false}
                                    value={speakerState.speakerCount ?? ''}
                                    onChange={(value) => speakerState.setSpeakerCount(typeof value === 'number' ? value : null)}
                                    disabled={isBusy || !speakerState.supportsExactCount}
                                    size="xs"
                                />}
                                <Divider />
                            </>
                        ) : null}
                        <Button size="compact-sm" variant="light" leftSection={<IconRefresh size={15} />} disabled={isBusy} onClick={start}>
                            {hasSpeakers ? 'Analyze speakers again' : speakerState.status === 'error' ? 'Retry speaker analysis' : 'Analyze speakers'}
                        </Button>
                        {hasSpeakers ? (
                            <>
                                <Button size="compact-sm" variant="subtle" justify="flex-start" leftSection={<IconPencil size={15} />} disabled={isBusy || speakers.length === 0} onClick={() => {
                                    const first = speakers[0];
                                    if (!first) return;
                                    setSettingsOpened(false);
                                    setEditError(null);
                                    setRenameId(first.id);
                                    setRenameValue(first.name);
                                }}>Rename speaker</Button>
                                <Button size="compact-sm" variant="subtle" justify="flex-start" leftSection={<IconArrowMerge size={15} />} disabled={isBusy || speakers.length === 0} onClick={() => {
                                    setSettingsOpened(false);
                                    setEditError(null);
                                    setMergeSourceId(speakers[0]?.id ?? null);
                                    setMergeTargetId(speakers[1]?.id ?? '__unknown__');
                                }}>Merge speakers</Button>
                            </>
                        ) : null}
                        {speakerState.assets?.cudaAvailable && !speakerState.assets.cudaReady ? (
                            <Button size="compact-sm" variant="subtle" disabled={isBusy} onClick={() => { void execute(store.prepareSpeakerAssets(true)); }}>
                                Prepare CUDA component
                            </Button>
                        ) : null}
                        {transcript.speakers?.provenance ? <Text size="xs" c="dimmed">{transcript.speakers.provenance.engine === 'nemotron-3' ? 'Nemotron 3' : 'Community-1'} · {transcript.speakers.provenance.backend.toUpperCase()} · {transcript.speakers.provenance.audioMode === 'optimized' ? 'Optimized' : 'Original'}</Text> : null}
                    </Stack>
                </Popover.Dropdown>
            </Popover>
            <Modal opened={confirmRerun} onClose={() => setConfirmRerun(false)} title="Replace speaker labels?" centered={true}>
                <Stack gap="sm">
                    <Text size="sm">A successful analysis will replace speaker names, assignments, and merges. The current labels stay in place if analysis fails or is cancelled.</Text>
                    <Group justify="flex-end">
                        <Button variant="default" onClick={() => setConfirmRerun(false)}>Cancel</Button>
                        <Button color="red" onClick={() => {
                            setConfirmRerun(false);
                            void execute(store.analyzeSpeakers(true));
                        }}>Analyze again</Button>
                    </Group>
                </Stack>
            </Modal>
            <Modal opened={renameId !== null} onClose={() => { if (!editPending) { setRenameId(null); setEditError(null); } }} title="Rename speaker" centered={true}>
                <Stack gap="sm">
                    <Select label="Speaker" data={options} value={renameId} onChange={(value) => {
                        setRenameId(value);
                        setRenameValue(speakers.find((speaker) => speaker.id === value)?.name ?? '');
                    }} disabled={editPending !== null} />
                    <TextInput label="Name" value={renameValue} onChange={(event) => setRenameValue(event.currentTarget.value)} maxLength={80} disabled={editPending !== null} />
                    {editError ? <Alert color="red" title="Could not save">{editError}</Alert> : null}
                    <Button loading={editPending === 'rename'} disabled={!renameId || !renameValue.trim() || isBusy} onClick={() => {
                        if (!renameId) return;
                        void saveEdit('rename', store.renameSpeaker(renameId, renameValue), () => setRenameId(null));
                    }}>Save name</Button>
                </Stack>
            </Modal>
            <Modal opened={mergeSourceId !== null} onClose={() => { if (!editPending) { setMergeSourceId(null); setEditError(null); } }} title="Merge speakers" centered={true}>
                <Stack gap="sm">
                    <Select label="Merge this speaker" data={assignmentOptions} value={mergeSourceId} onChange={setMergeSourceId} disabled={editPending !== null} />
                    <Select label="Into this speaker" data={assignmentOptions} value={mergeTargetId} onChange={setMergeTargetId} disabled={editPending !== null} />
                    <Text size="sm">{mergeTargetId === '__unknown__' ?
                        'All passages from this speaker will become unassigned, and the speaker will be removed. This cannot be undone.' :
                        mergeSourceId === '__unknown__' ?
                            'All unassigned passages will be assigned to the selected speaker. This cannot be undone.' :
                            'The target identity and name will survive. This merge cannot be undone.'}</Text>
                    {editError ? <Alert color="red" title="Could not save">{editError}</Alert> : null}
                    <Button color="red" loading={editPending === 'merge'} disabled={!mergeSourceId || !mergeTargetId || mergeSourceId === mergeTargetId || isBusy} onClick={() => {
                        if (!mergeSourceId || !mergeTargetId) return;
                        void saveEdit('merge', store.mergeSpeakers(
                            mergeSourceId === '__unknown__' ? null : mergeSourceId,
                            mergeTargetId === '__unknown__' ? null : mergeTargetId,
                        ), () => setMergeSourceId(null));
                    }}>Confirm merge</Button>
                </Stack>
            </Modal>
            <Modal opened={selectedSpan !== null} onClose={() => {
                if (!editPending) { setAssignId(null); setEditError(null); onCloseSpan(); }
            }} title="Assign speaker" centered={true}>
                <Stack gap="sm">
                    <Text size="sm" lineClamp={3}>{selectedSpan && selectedSpan.spans.length > 1 ? `${selectedSpan.spans.length} transcript fragments` : selectedSegment?.text}</Text>
                    <Select label="Speaker" data={assignmentOptions} value={assignId ?? selectedSegment?.speakerId ?? '__unknown__'} onChange={setAssignId} disabled={editPending !== null} />
                    {editError ? <Alert color="red" title="Could not save">{editError}</Alert> : null}
                    <Button loading={editPending === 'assign'} disabled={!selectedSpan || isBusy} onClick={() => {
                        if (!selectedSpan) return;
                        void saveEdit('assign', store.assignSpeaker(selectedSpan,
                            (assignId ?? selectedSegment?.speakerId ?? '__unknown__') === '__unknown__' ?
                                null : (assignId ?? selectedSegment?.speakerId ?? null)), () => {
                            onCloseSpan();
                            setAssignId(null);
                        });
                    }}>Save assignment</Button>
                </Stack>
            </Modal>
        </>
    );
});

export const SpeakerAnalysisStatus: React.FC = observer(() => {
    const store = useAppStore();
    const speakerState = store.speakers;
    const isRunning = store.operations.kind === 'analyzing-speakers'
        || store.operations.kind === 'preparing-speaker-assets';
    const hasError = speakerState.status === 'error' && speakerState.errorMessage;

    if (!isRunning && !hasError && !speakerState.usedCpuFallback) return null;

    return (
        <Stack gap={8}>
            {isRunning ? (
                <Group gap={8} align="center" wrap="nowrap" role="status">
                    <Text size="sm">{phaseLabels[speakerState.phase ?? 'preparing']}{speakerState.phase === 'analyzing' && speakerState.percent !== null ? ` (${speakerState.percent}%)` : ''}</Text>
                    {speakerState.phase === 'downloading' && speakerState.totalBytes > 0 ? (
                        <Progress value={100 * speakerState.downloadedBytes / speakerState.totalBytes} size="sm" style={{ flex: 1 }} />
                    ) : <Loader size="xs" />}
                    <Button size="compact-sm" color="red" variant="subtle" onClick={async () => {
                        const result = await store.stopSpeakerAnalysis();
                        if (!result.ok) store.activityLog.appendEvent(result.message);
                    }}>Cancel</Button>
                </Group>
            ) : null}
            {hasError ? <Alert color="yellow" title="Speaker action failed">{speakerState.errorMessage}</Alert> : null}
            {speakerState.usedCpuFallback ? (
                <Alert color="yellow" title="Using CPU">CUDA was unavailable. Speaker analysis continued on CPU.</Alert>
            ) : null}
        </Stack>
    );
});
