import { Alert, Box, Button, Group, Modal, Stack, Text } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { observer } from 'mobx-react-lite';
import React, { useState } from 'react';
import { ShowInLog } from 'renderer/src/shared/InlineAlert';
import { useAppStore } from 'renderer/src/AppContext';

const formatSize = (bytes: number): string => bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
const formatAge = (ageMs: number): string => {
    const hours = Math.floor(ageMs / 3_600_000);
    return hours < 24 ? `${Math.max(1, hours)}h ago` : `${Math.floor(hours / 24)}d ago`;
};

export const RecordingRecovery: React.FC = observer(() => {
    const { recordingRecovery, operationBlockReason } = useAppStore();
    const [discardId, setDiscardId] = useState<string | null>(null);
    const severity = recordingRecovery.items.some((item) => item.ageMs >= recordingRecovery.warningAgeMs) ? 'error' : 'warning';
    if (!recordingRecovery.hasItems && !recordingRecovery.error) return null;
    return (
        <>
            <Alert id="unfinished-recordings" tabIndex={-1} role="alert" icon={<IconAlertTriangle size={16} />} color={severity === 'error' ? 'red' : 'yellow'}
                title={recordingRecovery.items.length === 1 ? 'Unfinished recording' : 'Unfinished recordings'} p={12}
                styles={{ root: { border: `1px solid var(--brand-color-${severity}-border)`, background: `var(--brand-color-${severity}-bg)`, color: 'var(--brand-color-text)' }, title: { fontSize: 14 }, message: { color: 'var(--brand-color-text)' } }}>
                <Stack gap={10}>
                    <Text size="xs">{'Audio from an interrupted recording is available.'}</Text>
                    {recordingRecovery.items.map((item) => (
                        <Box key={item.recordingId}>
                            <Stack gap={6}>
                                <Text size="xs">{`${formatAge(item.ageMs)} · ${formatSize(item.sizeBytes)}`}</Text>
                                <Text size="xs" c="dimmed">
                                    {item.state === 'unknown' ? 'Unknown recovery data' : item.sources.map((source) => source === 'system' ? 'System audio' : 'Microphone').join(', ')}
                                </Text>
                                {item.sourceWarnings.map((warning) => (
                                    <Text key={warning.source} size="xs" c="yellow.8">{`${warning.source === 'system' ? 'System audio' : 'Microphone'}: ${warning.message}`}</Text>
                                ))}
                                <Group gap={6}>
                                    <Button size="xs" disabled={!item.canRecover || Boolean(operationBlockReason)} title={operationBlockReason} aria-description={operationBlockReason}
                                        loading={recordingRecovery.activeRecordingId === item.recordingId}
                                        onClick={() => void recordingRecovery.recover(item.recordingId)}>{'Recover'}</Button>
                                    <Button size="xs" variant="default" disabled={Boolean(operationBlockReason)} title={operationBlockReason} aria-description={operationBlockReason}
                                        onClick={() => setDiscardId(item.recordingId)}>{'Delete'}</Button>
                                </Group>
                            </Stack>
                        </Box>
                    ))}
                    <ShowInLog />
                    {recordingRecovery.error ? <Text size="sm" c="red">{recordingRecovery.error}</Text> : null}
                </Stack>
            </Alert>
            <Modal opened={discardId !== null} onClose={() => setDiscardId(null)} title="Delete unfinished recording?" centered={true}>
                <Stack>
                    <Text size="sm">{'This permanently deletes the only known copy of this recording.'}</Text>
                    <Group justify="flex-end">
                        <Button variant="default" onClick={() => setDiscardId(null)}>{'Cancel'}</Button>
                        <Button color="red" disabled={Boolean(operationBlockReason)} title={operationBlockReason} aria-description={operationBlockReason} onClick={() => {
                            if (discardId) void recordingRecovery.discard(discardId);
                            setDiscardId(null);
                        }}>{'Delete recording'}</Button>
                    </Group>
                </Stack>
            </Modal>
        </>
    );
});
