import { Button, Group, Stack, Text } from '@mantine/core';
import { IconFileMusic } from '@tabler/icons-react';
import { SystemAudioRecorder } from '@~/recorder';
import { useAtom } from 'jotai';
import { type FC } from 'react';
import { atoms } from 'renderer/src/atoms';
import { useApp } from '../../../../../AppContext';

export const FileSelect: FC = () => {
    const { isElectron } = useApp();
    const [audioToTranscribe, setAudioToTranscribe] = useAtom(atoms.transcription.audioToTranscribe);
    const [, setRunOutcome] = useAtom(atoms.transcription.runOutcome);
    const [, setRunErrorMessage] = useAtom(atoms.transcription.runErrorMessage);

    const handlePick = async () => {
        if (!isElectron) return;
        const file = await window.api!.pickAudio();

        if (!file) {
            return;
        }

        try {
            const { path } = await window.api!.convertAudio({ audioPath: file, lowPass: 12000, highPass: 80 });

            setAudioToTranscribe([path]);
            setRunOutcome('none');
            setRunErrorMessage(null);
        } catch (error) {
            console.error('Failed to convert audio', error);
        }
    };

    const selectedLabel = audioToTranscribe.length > 0
        ? audioToTranscribe.join(', ')
        : 'No file selected';

    return (
        <Stack gap={12}>
            <Group gap={12} align="center">
                <Button
                    onClick={handlePick}
                    leftSection={<IconFileMusic size={16} />}
                >
                    {'Choose audio file'}
                </Button>
                <Text size="sm" c="dimmed">
                    {selectedLabel}
                </Text>
            </Group>
            <SystemAudioRecorder />
        </Stack>
    );
};
