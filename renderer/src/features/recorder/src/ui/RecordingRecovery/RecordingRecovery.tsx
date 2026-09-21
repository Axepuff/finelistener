import { Alert, Button, Group, Modal, Paper, Stack, Text } from '@mantine/core';
import { observer } from 'mobx-react-lite';
import React, { useState } from 'react';
import { useAppStore } from 'renderer/src/AppContext';

const formatSize = (bytes: number): string => bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
const formatAge = (ageMs: number): string => {
    const hours = Math.floor(ageMs / 3_600_000);
    return hours < 24 ? `${Math.max(1, hours)}h ago` : `${Math.floor(hours / 24)}d ago`;
};

export const RecordingRecovery: React.FC = observer(() => {
    const { recordingRecovery } = useAppStore();
    const [discardId, setDiscardId] = useState<string | null>(null);
    if (!recordingRecovery.hasItems && !recordingRecovery.error) return null;
    return (
        <>
            <Alert color={recordingRecovery.items.some((item) => item.ageMs >= recordingRecovery.warningAgeMs) ? 'red' : 'yellow'} title="Unfinished recordings">
                <Stack gap={10}>
                    <Text size="sm">{'Audio from an interrupted recording is available.'}</Text>
                    {recordingRecovery.items.map((item) => (
                        <Paper key={item.recordingId} withBorder={true} p="sm">
                            <Stack gap={6}>
                                <Text size="sm">{`${formatAge(item.ageMs)} · ${formatSize(item.sizeBytes)}`}</Text>
                                <Text size="xs" c="dimmed">
                                    {item.state === 'unknown' ? 'Unknown recovery data' : item.sources.map((source) => source === 'system' ? 'System audio' : 'Microphone').join(', ')}
                                </Text>
                                {item.sourceWarnings.map((warning) => (
                                    <Text key={warning.source} size="xs" c="yellow.8">{`${warning.source === 'system' ? 'System audio' : 'Microphone'}: ${warning.message}`}</Text>
                                ))}
                                <Group gap={6}>
                                    <Button size="compact-xs" disabled={!item.canRecover || recordingRecovery.activeRecordingId !== null}
                                        loading={recordingRecovery.activeRecordingId === item.recordingId}
                                        onClick={() => void recordingRecovery.recover(item.recordingId)}>{'Recover'}</Button>
                                    <Button size="compact-xs" variant="outline" color="red" disabled={recordingRecovery.activeRecordingId !== null}
                                        onClick={() => setDiscardId(item.recordingId)}>{'Delete'}</Button>
                                </Group>
                            </Stack>
                        </Paper>
                    ))}
                    {recordingRecovery.error ? <Text size="sm" c="red">{recordingRecovery.error}</Text> : null}
                </Stack>
            </Alert>
            <Modal opened={discardId !== null} onClose={() => setDiscardId(null)} title="Delete unfinished recording?" centered={true}>
                <Stack>
                    <Text size="sm">{'This permanently deletes the only known copy of this recording.'}</Text>
                    <Group justify="flex-end">
                        <Button variant="default" onClick={() => setDiscardId(null)}>{'Cancel'}</Button>
                        <Button color="red" onClick={() => {
                            if (discardId) void recordingRecovery.discard(discardId);
                            setDiscardId(null);
                        }}>{'Delete recording'}</Button>
                    </Group>
                </Stack>
            </Modal>
        </>
    );
});
