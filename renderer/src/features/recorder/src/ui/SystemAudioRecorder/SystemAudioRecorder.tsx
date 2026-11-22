import { Stack } from '@mantine/core';
import { SystemAudioRecorderLevelMeter } from '@~/recorder/src/ui/SystemAudioRecorder/SystemAudioRecorderLevelMeter';
import React from 'react';
import { SystemAudioRecorderAlerts } from './SystemAudioRecorderAlerts';
import { SystemAudioRecorderControls } from './SystemAudioRecorderControls';

interface SystemAudioRecorderProps {
    variant?: 'workspace' | 'sources';
}

export const SystemAudioRecorder: React.FC<SystemAudioRecorderProps> = ({ variant }) => {

    return (
        <Stack gap={12}>
            <SystemAudioRecorderControls variant={variant} />
            {variant !== 'sources' ? <SystemAudioRecorderLevelMeter /> : null}
            <SystemAudioRecorderAlerts />
        </Stack>
    );
};
