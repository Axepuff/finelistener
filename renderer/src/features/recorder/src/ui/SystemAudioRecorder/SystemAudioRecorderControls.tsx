import { ActionIcon, Box, Button, Center, Group, Select, Stack, Text } from '@mantine/core';
import { IconMicrophone, IconPlayerStopFilled } from '@tabler/icons-react';
import { useSystemAudioRecorder } from '@~/recorder/src/ui/SystemAudioRecorder/core/useSystemAudioRecorder';
import type { RecordingDevice } from 'electron/src/services/capture/CaptureAdapter';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { formatDuration, formatLevel, getRecordingDeviceId } from './core/recordingUtils';

const formatDeviceLabel = (device: RecordingDevice): string => {
    return device.isDefault ? `${device.name} (Default)` : device.name;
};

interface SystemAudioRecorderControlsProps {
    variant?: 'workspace' | 'sources';
}

export const SystemAudioRecorderControls: React.FC<SystemAudioRecorderControlsProps> = observer(({ variant }) => {
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

    const sources = isWindows ? (
        <Stack gap={8}>
            <Select
                label="System audio"
                data={sourceOptions('system', systemDeviceId)}
                value={systemDeviceId ?? '__off__'}
                onChange={(value) => onSourceChange('system', value === '__off__' ? null : value)}
                disabled={sourceSelectionDisabled}
                aria-description={variant === 'sources' ? 'Recording sources are locked until the recording ends.' : undefined}
            />
            <Select
                label="Microphone"
                data={sourceOptions('microphone', microphoneDeviceId)}
                value={microphoneDeviceId ?? '__off__'}
                onChange={(value) => onSourceChange('microphone', value === '__off__' ? null : value)}
                disabled={sourceSelectionDisabled}
                aria-description={variant === 'sources' ? 'Recording sources are locked until the recording ends.' : undefined}
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
            maw={variant === 'workspace' ? undefined : 240}
            disabled={isRecordingActive || sourceSelectionDisabled}
            aria-description={variant === 'sources' ? 'Recording sources are locked until the recording ends.' : undefined}
        />
    ) : null;

    if (variant === 'sources') {
        return (
            <Stack role="group" aria-label="Recording sources" aria-describedby="recording-sources-locked" gap={8}>
                <Text id="recording-sources-locked" size="xs" c="dimmed">Recording sources are locked until the recording ends.</Text>
                {sources ?? <Text size="sm">System audio</Text>}
            </Stack>
        );
    }

    const buttonLabel = isRecordingActive ? 'Stop recording' : 'Start recording';
    const buttonAction = isRecordingActive ? onStopRecording : onStartRecording;
    const buttonDisabled = isRecordingActive ? !canStopRecording : !canStartRecording;

    return (
        <Stack gap={variant === 'workspace' ? 16 : undefined}>
            {variant === 'workspace' ? (
                <>
                    <Stack role="group" aria-label="Recording source" gap={4}>
                        <Text size="xs" c="var(--brand-color-text-secondary)">{'Recording source'}</Text>
                        {sources ?? <Text size="sm">{'System audio'}</Text>}
                    </Stack>
                    <Button size="lg" fz="sm" disabled={buttonDisabled} onClick={buttonAction} leftSection={isRecordingActive ? (
                        <IconPlayerStopFilled size={12} color="var(--brand-color-error)" aria-hidden="true" />
                    ) : (
                        <Box component="span" aria-hidden="true" w={10} h={10} bg="var(--brand-color-error)" style={{ borderRadius: '50%' }} />
                    )}>
                        {buttonLabel}
                    </Button>
                </>
            ) : (
                <Center>
                    <Stack align="center" gap={4}>
                        <ActionIcon color="red" radius="xl" size={48} disabled={buttonDisabled} aria-label={buttonLabel} onClick={buttonAction}>
                            {isRecordingActive ? <IconPlayerStopFilled /> : <IconMicrophone />}
                        </ActionIcon>
                        {!isRecordingActive ? <Text size="sm">{isWindows ? 'Record audio' : 'Record system audio'}</Text> : null}
                    </Stack>
                </Center>
            )}
            {isRecordingActive ? (
                <Group>
                    <Text size="sm" c="dimmed">{`Recording: ${durationLabel}`}</Text>
                    {Object.keys(sourceLevels).length > 0 ? (['system', 'microphone'] as const).map((source) => sourceLevels[source] ? (
                        <Text key={source} size="sm" c="dimmed">
                            {`${source === 'system' ? 'System audio' : 'Microphone'}: ${formatLevel(sourceLevels[source])}`}
                        </Text>
                    ) : null) : (
                        <Text size="sm" c="dimmed">{`Level: ${levelLabel}`}</Text>
                    )}
                    <Text size="sm" c="dimmed">{writtenLabel}</Text>
                </Group>
            ) : null}
            {variant === 'workspace' ? null : sources}
        </Stack>
    );
});
