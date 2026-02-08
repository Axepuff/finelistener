import { LinearProgress } from '@mui/material';
import { useSystemAudioRecorder } from '@~/recorder/src/ui/SystemAudioRecorder/core/useSystemAudioRecorder';

export const SystemAudioRecorderLevelMeter: React.FC = () => {
    const { meter } = useSystemAudioRecorder();

    if (meter.recordingState !== 'recording') return null;

    const value = Math.min(100, Math.max(0, (meter.recordingLevel?.peak ?? 0) * 100));

    return (
        <LinearProgress
            variant="determinate"
            color={meter.recordingLevel?.clipped ? 'error' : 'primary'}
            value={value}
        />
    );
};
