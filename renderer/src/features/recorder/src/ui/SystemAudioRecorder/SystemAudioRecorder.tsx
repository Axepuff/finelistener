import { Stack } from '@mantine/core';
import { SystemAudioRecorderLevelMeter } from '@~/recorder/src/ui/SystemAudioRecorder/SystemAudioRecorderLevelMeter';
import React from 'react';
import { SystemAudioRecorderAlerts } from './SystemAudioRecorderAlerts';
import { SystemAudioRecorderControls } from './SystemAudioRecorderControls';

export const SystemAudioRecorder: React.FC = () => {

    return (
        <Stack gap={12}>
            <SystemAudioRecorderControls />
            <SystemAudioRecorderLevelMeter />
            <SystemAudioRecorderAlerts />
        </Stack>
    );
};
