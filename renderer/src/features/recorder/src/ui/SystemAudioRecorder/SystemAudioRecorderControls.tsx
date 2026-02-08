import { ActionIcon, Button, Group, Loader, Select, Text } from '@mantine/core';
import { IconPlayerRecordFilled, IconPlayerStopFilled } from '@tabler/icons-react';
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
            isProcessingRecording,
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
        <Group gap={12} align="center" wrap="wrap">
            <Button
                color="red"
                leftSection={<IconPlayerRecordFilled size={16} />}
                disabled={!canStartRecording}
                onClick={onStartRecording}
            >
                {'Record system audio'}
            </Button>
            <ActionIcon color="red" onClick={onStopRecording} disabled={!canStopRecording}>
                <IconPlayerStopFilled size={16} />
            </ActionIcon>
            {isProcessingRecording ? <Loader size={18} /> : null}
            <Text size="sm" c="dimmed">
                {isRecordingActive ? `Recording: ${durationLabel}` : 'Recording inactive'}
            </Text>
            <Text size="sm" c="dimmed">
                {`Level: ${levelLabel}`}
            </Text>
            <Text size="sm" c="dimmed">
                {writtenLabel}
            </Text>
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
        </Group>
    );
};
