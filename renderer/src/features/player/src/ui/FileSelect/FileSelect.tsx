import { Button, Paper, SegmentedControl, Stack, Text } from '@mantine/core';
import { IconFileMusic } from '@tabler/icons-react';
import { SystemAudioRecorder } from '@~/recorder';
import { useAtom } from 'jotai';
import { useMemo, useState, type FC } from 'react';
import { atoms } from 'renderer/src/atoms';
import { useApp } from '../../../../../AppContext';

type SourceMode = 'file' | 'record';

const SOURCE_MODE_OPTIONS = [
    { label: 'File', value: 'file' },
    { label: 'Record', value: 'record' },
];

const shortenFileName = (target: string): string => target.split(/[/\\]/).pop() || target;

export const FileSelect: FC = () => {
    const { isElectron } = useApp();
    const [sourceMode, setSourceMode] = useState<SourceMode>('file');
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

    const selectedLabel = useMemo(() => {
        if (audioToTranscribe.length === 0) {
            return 'No file selected';
        }

        return audioToTranscribe.map(shortenFileName).join(', ');
    }, [audioToTranscribe]);

    return (
        <Stack gap={12}>
            <SegmentedControl
                fullWidth={true}
                value={sourceMode}
                data={SOURCE_MODE_OPTIONS}
                onChange={(value) => setSourceMode(value as SourceMode)}
            />
            {sourceMode === 'file' ? (
                <Paper
                    withBorder={true}
                    style={{
                        padding: 16,
                        borderStyle: 'dashed',
                        borderColor: 'var(--mantine-color-gray-4)',
                    }}
                >
                    <Stack gap={8}>
                        <Button
                            onClick={handlePick}
                            leftSection={<IconFileMusic size={16} />}
                            variant="light"
                        >
                            {'Choose audio file'}
                        </Button>
                        <Text size="sm" c="dimmed" style={{ wordBreak: 'break-word' }}>
                            {selectedLabel}
                        </Text>
                    </Stack>
                </Paper>
            ) : (
                <SystemAudioRecorder />
            )}
        </Stack>
    );
};
