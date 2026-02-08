import { Progress } from '@mantine/core';
import { useSystemAudioRecorder } from '@~/recorder/src/ui/SystemAudioRecorder/core/useSystemAudioRecorder';

export const SystemAudioRecorderLevelMeter: React.FC = () => {
    const { meter } = useSystemAudioRecorder();

    if (meter.recordingState !== 'recording') return null;

    const value = Math.min(100, Math.max(0, (meter.recordingLevel?.peak ?? 0) * 100));

    return (
        <Progress
            color={meter.recordingLevel?.clipped ? 'red' : 'gray'}
            value={value}
            size={4}
        />
    );
};
