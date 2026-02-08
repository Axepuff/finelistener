import { Button, Group, Stack, Text } from '@mantine/core';
import { useSystemAudioRecorder } from '@~/recorder/src/ui/SystemAudioRecorder/core/useSystemAudioRecorder';
import React from 'react';

export const SystemAudioRecorderAlerts: React.FC = () => {
    const { alerts } = useSystemAudioRecorder();

    return (
        <Stack gap={12}>
            {alerts.recordingError ? (
                <Text size="sm" c="red">
                    {alerts.recordingError}
                </Text>
            ) : null}
            {alerts.showSilenceWarning ? (
                <Stack gap={8}>
                    <Text size="sm" c="yellow.7">
                        {alerts.isMacOS
                            ? "No system audio detected. On macOS, check that 'System Audio Recording' permission is enabled."
                            : 'No system audio detected. Check that audio is playing.'}
                    </Text>
                    {alerts.isMacOS ? (
                        <Group gap={8} align="center" wrap="wrap">
                            <Button size="compact-sm" variant="outline" color="yellow" onClick={alerts.onOpenRecordingPreferences}>
                                {'Open privacy settings'}
                            </Button>
                            <Button size="compact-sm" variant="outline" color="yellow" onClick={alerts.onRevealDevApp}>
                                {'Reveal dev app'}
                            </Button>
                            <Text size="sm" c="dimmed">
                                {"If the app doesn't show up, click '+' and add 'out/dev/FineListener Dev.app' manually."}
                            </Text>
                        </Group>
                    ) : null}
                </Stack>
            ) : null}
            {alerts.deviceError ? (
                <Text size="sm" c="yellow.7">
                    {`Failed to load devices: ${alerts.deviceError}`}
                </Text>
            ) : null}
            {!alerts.isRecordingAvailable ? (
                <Text size="sm" c="yellow.7">
                    {'System audio recording is unavailable.'}
                </Text>
            ) : null}
        </Stack>
    );
};
