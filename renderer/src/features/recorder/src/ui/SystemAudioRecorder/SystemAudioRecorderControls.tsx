import { ActionIcon, Center, Group, Select, Stack, Text } from '@mantine/core';
import { IconMicrophone, IconPlayerStopFilled } from '@tabler/icons-react';
import { useSystemAudioRecorder } from '@~/recorder/src/ui/SystemAudioRecorder/core/useSystemAudioRecorder';
import type { RecordingDevice } from 'electron/src/services/capture/CaptureAdapter';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { formatDuration, formatLevel, getRecordingDeviceId } from './core/recordingUtils';

const formatDeviceLabel = (device: RecordingDevice): string => {
    return device.isDefault ? `${device.name} (Default)` : device.name;
};

export const SystemAudioRecorderControls: React.FC = observer(() => {
    const {
        controls: {
            canStartRecording,
            canStopRecording,
            isRecordingActive,
            recordingDurationMs,
            recordingLevel,
            recordingBytesWritten,
            sourceLevels,
            devices,
            selectedDeviceId,
            showDeviceSelect,
            isWindows,
            sourceSelectionDisabled,
            systemDeviceId,
            microphoneDeviceId,
            onSourceChange,
            onStartRecording,
            onStopRecording,
            onDeviceChange,
        },
    } = useSystemAudioRecorder();

    const levelLabel = formatLevel(recordingLevel);
    const durationLabel = formatDuration(recordingDurationMs);
    const writtenLabel = recordingBytesWritten !== null ?
        `Written: ${Math.round(recordingBytesWritten / 1024)} KB` :
        'Written: N/A';
    const deviceOptions = devices
        .map((device) => {
            const value = getRecordingDeviceId(device);

            if (!value) return null;

            return { value, label: formatDeviceLabel(device) };
        })
        .filter((device): device is { value: string; label: string } => device !== null);

    const sourceOptions = (source: 'system' | 'microphone', selected: string | null) => {
        const options = devices.filter((device) => (device.source ?? 'system') === source)
            .map((device) => ({ value: getRecordingDeviceId(device), label: formatDeviceLabel(device) }))
            .filter((device) => device.value !== '');

        if (selected && !options.some((device) => device.value === selected)) {
            options.push({ value: selected, label: 'Unavailable device' });
        }

        return [{ value: '__off__', label: 'Off' }, { value: '', label: 'Default device' }, ...options];
    };

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
                    <Text size="sm">{isWindows ? 'Record audio' : 'Record system audio'}</Text>
                </Stack>
            )}

            {isRecordingActive ? (
                <Group>
                    <Text size="sm" c="dimmed">
                        {`Recording: ${durationLabel}`}
                    </Text>
                    {Object.keys(sourceLevels).length > 0 ? (['system', 'microphone'] as const).map((source) => sourceLevels[source] ? (
                        <Text key={source} size="sm" c="dimmed">
                            {`${source === 'system' ? 'System audio' : 'Microphone'}: ${formatLevel(sourceLevels[source])}`}
                        </Text>
                    ) : null) : (
                        <Text size="sm" c="dimmed">{`Level: ${levelLabel}`}</Text>
                    )}
                    <Text size="sm" c="dimmed">
                        {writtenLabel}
                    </Text>
                </Group>
            ) : null}

            {isWindows ? (
                <Stack gap={8}>
                    <Select
                        label="System audio"
                        data={sourceOptions('system', systemDeviceId)}
                        value={systemDeviceId ?? '__off__'}
                        onChange={(value) => onSourceChange('system', value === '__off__' ? null : value)}
                        disabled={sourceSelectionDisabled}
                    />
                    <Select
                        label="Microphone"
                        data={sourceOptions('microphone', microphoneDeviceId)}
                        value={microphoneDeviceId ?? '__off__'}
                        onChange={(value) => onSourceChange('microphone', value === '__off__' ? null : value)}
                        disabled={sourceSelectionDisabled}
                    />
                    {systemDeviceId === null && microphoneDeviceId === null ? (
                        <Text size="sm" c="dimmed">{'Enable at least one recording source.'}</Text>
                    ) : null}
                </Stack>
            ) : showDeviceSelect ? (
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
});
