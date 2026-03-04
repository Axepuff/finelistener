import { Button, Paper, SegmentedControl, Stack, Text } from '@mantine/core';
import { IconFileMusic } from '@tabler/icons-react';
import { SystemAudioRecorder } from '@~/recorder';
import { useAtom, useSetAtom } from 'jotai';
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
    const [, setCurrentSessionId] = useAtom(atoms.sessions.currentSessionId);
    const setCurrentSessionDetails = useSetAtom(atoms.sessions.currentSessionDetails);
    const setAudioMode = useSetAtom(atoms.sessions.audioMode);
    const [, clearOutput] = useAtom(atoms.clearTranscriptionOutput);
    const refreshSessions = useSetAtom(atoms.refreshSessions);

    const handlePick = async () => {
        if (!isElectron) return;

        try {
            const session = await window.api!.sessions.importAudio();

            if (!session) {
                return;
            }

            clearOutput();
            setCurrentSessionId(session.id);
            setCurrentSessionDetails(session);
            setAudioMode('original');
            setAudioToTranscribe([session.audioWavPath]);
            void refreshSessions();
        } catch (error) {
            console.error('Failed to import audio into a session', error);
        }
    };

    const selectedLabel = useMemo(() => {
        if (audioToTranscribe.length === 0) {
            return null;
        }

        return audioToTranscribe.map(shortenFileName).join(', ');
    }, [audioToTranscribe]);

    return (
        <Paper
            style={{
                padding: 16,
                borderColor: 'var(--mantine-color-gray-4)',
            }}
        >
            <Stack gap={12}>
                <SegmentedControl
                    fullWidth={true}
                    value={sourceMode}
                    data={SOURCE_MODE_OPTIONS}
                    onChange={(value) => setSourceMode(value as SourceMode)}
                />
                {sourceMode === 'file' ? (
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
                ) : (
                    <SystemAudioRecorder />
                )}
            </Stack>
        </Paper>
    );
};
