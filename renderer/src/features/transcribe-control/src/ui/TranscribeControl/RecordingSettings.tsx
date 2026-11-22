import { Box } from '@mantine/core';
import { SystemAudioRecorder } from '@~/recorder';
import { observer } from 'mobx-react-lite';
import React, { useEffect, useRef } from 'react';
import { useAppStore } from '../../../../../AppContext';

export const RecordingSettings: React.FC = observer(() => {
    const { recording } = useAppStore();
    const disclosure = useRef<HTMLDetailsElement>(null);
    const { recordingState, recordingError, showSilenceWarning } = recording.session;
    const { deviceError } = recording.devices;
    const { isRecordingAvailable } = recording.availability;

    useEffect(() => {
        // Title-bar recording actions must also reveal the existing controls and alerts.
        if (recordingState !== 'idle' || recordingError || showSilenceWarning || deviceError || !isRecordingAvailable) {
            if (disclosure.current) {
                disclosure.current.open = true;
                disclosure.current.lastElementChild?.scrollIntoView({ block: 'nearest' });
            }
        }
    }, [recordingState, recordingError, showSilenceWarning, deviceError, isRecordingAvailable]);

    return (
        <details ref={disclosure} className="settings-recording">
            <summary>Recording settings</summary>
            <Box role="region" aria-label="Recording controls" pt={12}>
                <SystemAudioRecorder />
            </Box>
        </details>
    );
});
