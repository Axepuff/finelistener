import Stack from '@mui/material/Stack';
import { SystemAudioRecorderLevelMeter } from '@~/recorder/src/ui/SystemAudioRecorder/SystemAudioRecorderLevelMeter';
import React from 'react';
import { SystemAudioRecorderAlerts } from './SystemAudioRecorderAlerts';
import { SystemAudioRecorderControls } from './SystemAudioRecorderControls';

export const SystemAudioRecorder: React.FC = () => {

    return (
        <Stack spacing={2}>
            <SystemAudioRecorderControls />
            <SystemAudioRecorderLevelMeter />
            <SystemAudioRecorderAlerts />
        </Stack>
    );
};
