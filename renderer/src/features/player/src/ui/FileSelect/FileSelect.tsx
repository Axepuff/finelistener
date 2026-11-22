import { Button, Paper, SegmentedControl, Stack, Text } from '@mantine/core';
import { IconFileMusic } from '@tabler/icons-react';
import { SystemAudioRecorder } from '@~/recorder';
import { reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useState, type FC } from 'react';
import { useAppStore } from '../../../../../AppContext';

type SourceMode = 'file' | 'record';

const SOURCE_MODE_OPTIONS = [
    { label: 'File', value: 'file' },
    { label: 'Record', value: 'record' },
];

const shortenFileName = (target: string): string => target.split(/[/\\]/).pop() || target;

export const FileSelect: FC = observer(() => {
    const store = useAppStore();
    const [sourceMode, setSourceMode] = useState<SourceMode>('file');

    // Recording can also start from the title bar; switch to the recorder so its progress
    // and errors are visible. Each start attempt and each new error switches it again.
    useEffect(() => {
        const showRecorder = (shouldShow: unknown) => {
            if (shouldShow) setSourceMode('record');
        };
        const disposeOperation = reaction(() => store.operations.kind === 'recording', showRecorder, { fireImmediately: true });
        const disposeError = reaction(() => store.recording.session.recordingError, showRecorder, { fireImmediately: true });

        return () => {
            disposeOperation();
            disposeError();
        };
    }, [store]);

    const handlePick = async () => {
        const result = await store.importAudio();

        if (!result.ok) {
            store.activityLog.appendEvent(result.message);
        }
    };

    const selectedLabel = useMemo(() => {
        if (!store.workspace.audioSourcePath) return null;

        return shortenFileName(store.workspace.audioSourcePath);
    }, [store.workspace.audioSourcePath]);

    return (
        <Paper
            style={{
                padding: 16,
                borderColor: 'var(--brand-color-border)',
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
                            disabled={store.operations.isBusy}
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
});
