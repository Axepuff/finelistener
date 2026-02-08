import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useSystemAudioRecorder } from '@~/recorder/src/ui/SystemAudioRecorder/core/useSystemAudioRecorder';
import React from 'react';

export const SystemAudioRecorderAlerts: React.FC = () => {
    const { alerts } = useSystemAudioRecorder();

    return (
        <Stack spacing={2}>
            {alerts.recordingError ? (
                <Typography variant="body2" sx={{ color: 'error.main' }}>
                    {alerts.recordingError}
                </Typography>
            ) : null}
            {alerts.showSilenceWarning ? (
                <Stack spacing={1}>
                    <Typography variant="body2" sx={{ color: 'warning.main' }}>
                        {alerts.isMacOS
                            ? "No system audio detected. On macOS, check that 'System Audio Recording' permission is enabled."
                            : 'No system audio detected. Check that audio is playing.'}
                    </Typography>
                    {alerts.isMacOS ? (
                        <Stack direction="row" spacing={1} alignItems="center">
                            <Button size="small" variant="outlined" color="warning" onClick={alerts.onOpenRecordingPreferences}>
                                {'Open privacy settings'}
                            </Button>
                            <Button size="small" variant="outlined" color="warning" onClick={alerts.onRevealDevApp}>
                                {'Reveal dev app'}
                            </Button>
                            <Typography variant="body2" sx={{ opacity: 0.7 }}>
                                {"If the app doesn't show up, click '+' and add 'out/dev/FineListener Dev.app' manually."}
                            </Typography>
                        </Stack>
                    ) : null}
                </Stack>
            ) : null}
            {alerts.deviceError ? (
                <Typography variant="body2" sx={{ color: 'warning.main' }}>
                    {`Failed to load devices: ${alerts.deviceError}`}
                </Typography>
            ) : null}
            {!alerts.isRecordingAvailable ? (
                <Typography variant="body2" sx={{ color: 'warning.main' }}>
                    {'System audio recording is unavailable.'}
                </Typography>
            ) : null}
        </Stack>
    );
};
