import { InlineAlert } from 'renderer/src/shared/InlineAlert';
import { useAppStore } from 'renderer/src/AppContext';
import { RECORDING_STORAGE_FULL_MESSAGE } from '../../../../../../../electron/src/types/recordingArchive';
import { Button, Group, Stack, Text } from '@mantine/core';
import { useSystemAudioRecorder } from '@~/recorder/src/ui/SystemAudioRecorder/core/useSystemAudioRecorder';
import { observer } from 'mobx-react-lite';
import React from 'react';

export const SystemAudioRecorderAlerts: React.FC = observer(() => {
    const { alerts } = useSystemAudioRecorder();
    const store = useAppStore();
    const permissionMissing = alerts.isMacOS && store.recording.availability.permissionStatus === 'denied';
    const storageFull = alerts.recordingError === RECORDING_STORAGE_FULL_MESSAGE;

    if (!permissionMissing && !alerts.recordingError && !alerts.showSilenceWarning && !alerts.deviceError && alerts.isRecordingAvailable) return null;

    return (
        <Stack gap={12}>
            {permissionMissing ? <InlineAlert title="Allow system audio recording" actions={<Button size="compact-sm" onClick={alerts.onOpenRecordingPreferences}>Open System Settings</Button>}>
                Turn on FineListener in System Settings › Privacy &amp; Security › Screen &amp; System Audio Recording, then come back.
            </InlineAlert> : null}
            {alerts.recordingError && !permissionMissing ? <InlineAlert title={storageFull ? 'Recording storage is full' : 'Recording failed'} actions={storageFull ?
                <Button size="compact-sm" onClick={() => { void store.recordingRecovery.refresh().then(() => {
                    document.getElementById('unfinished-recordings')?.focus();
                }); }}>Show unfinished recordings</Button> :
                <Button size="compact-sm" disabled={!store.isElectron || store.operations.isBusy} onClick={() => { void store.recording.startRecording(); }}>Retry recording</Button>}>
                {alerts.recordingError}
            </InlineAlert> : null}
            {alerts.showSilenceWarning ? (
                <Stack gap={8}>
                    <Text size="sm" c="yellow.7">
                        {alerts.isMacOS ?
                            "No system audio detected. On macOS, check that 'System Audio Recording' permission is enabled." :
                            'No audio detected. Check the selected recording devices.'}
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
});
