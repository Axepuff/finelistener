import { ActionIcon, Center, Group, Select, Stack, Text } from '@mantine/core';
import { IconMicrophone, IconPlayerStopFilled } from '@tabler/icons-react';
import { useSystemAudioRecorder } from '@~/recorder/src/ui/SystemAudioRecorder/core/useSystemAudioRecorder';
import type { RecordingDevice } from 'electron/src/services/capture/CaptureAdapter';
import React from 'react';
import { formatDuration, formatLevel, getRecordingDeviceId } from './core/recordingUtils';

const formatDeviceLabel = (device: RecordingDevice): string => {
    return device.isDefault ? `${device.name} (Default)` : device.name;
};

export const SystemAudioRecorderControls: React.FC = () => {
    const {
        controls: {
            canStartRecording,
            canStopRecording,
            isRecordingActive,
            recordingDurationMs,
            recordingLevel,
            recordingBytesWritten,
            devices,
            selectedDeviceId,
            showDeviceSelect,
            onStartRecording,
            onStopRecording,
            onDeviceChange,
        },
    } = useSystemAudioRecorder();

    const levelLabel = formatLevel(recordingLevel);
    const durationLabel = formatDuration(recordingDurationMs);
    const writtenLabel = recordingBytesWritten !== null
        ? `Written: ${Math.round(recordingBytesWritten / 1024)} KB`
        : 'Written: N/A';
    const deviceOptions = devices
        .map((device) => {
            const value = getRecordingDeviceId(device);

            if (!value) return null;

            return { value, label: formatDeviceLabel(device) };
        })
        .filter((device): device is { value: string; label: string } => device !== null);

    return (
        <Stack>
            {isRecordingActive ? (
                <Center>

                    <ActionIcon
                        color="red"
                        radius="xl"
                        disabled={!canStopRecording}
                        size={48}
                        onClick={onStopRecording}
                    >
                        <IconPlayerStopFilled />
                    </ActionIcon>
                </Center>
            ) : (
                <Stack align="center" gap={4}>
                    <ActionIcon
                        color="red"
                        disabled={!canStartRecording}
                        radius="xl"
                        size={48}
                        onClick={onStartRecording}
                    >
                        <IconMicrophone />
                    </ActionIcon>
                    <Text size="sm">{'Record system audio'}</Text>
                </Stack>
            )}

            {isRecordingActive ? (
                <Group>
                    <Text size="sm" c="dimmed">
                        {`Recording: ${durationLabel}`}
                    </Text>
                    <Text size="sm" c="dimmed">
                        {`Level: ${levelLabel}`}
                    </Text>
                    <Text size="sm" c="dimmed">
                        {writtenLabel}
                    </Text>
                </Group>
            ) : null}

            {showDeviceSelect ? (
                <Select
                    label="Output device"
                    data={deviceOptions}
                    value={selectedDeviceId || null}
                    onChange={(value) => {
                        if (!value) return;
                        onDeviceChange(value);
                    }}
                    w={240}
                    disabled={isRecordingActive}
                />
            ) : null}
        </Stack>
    );
};
