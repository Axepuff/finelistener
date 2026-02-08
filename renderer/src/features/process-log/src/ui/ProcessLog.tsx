import { Button, Collapse, Paper, Stack, Switch, Text } from '@mantine/core';
import { useAtom } from 'jotai';
import { FC, useEffect, useState } from 'react';
import { useApp } from 'renderer/src/AppContext';
import { atoms } from 'renderer/src/atoms';

const { transcription } = atoms;

export const ProcessLog: FC = () => {
    const { isElectron } = useApp();
    const [log, setLog] = useAtom(transcription.log);
    const [showLog, setShowLog] = useState(false);

    useEffect(() => {
        if (!isElectron) return;
        const off = window.api!.onTranscribeLog((line) => setLog((prev) => prev + line));

        return () => {
            off?.();
        };
    }, [isElectron, setLog]);

    return (
        <Stack gap={8}>
            <Switch
                checked={showLog}
                onChange={() => setShowLog((prev) => !prev)}
                label="Show log"
            />
            <Collapse in={showLog}>
                <Paper
                    withBorder={true}
                    style={{
                        padding: 18,
                        height: '300px',
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 12,
                    }}
                >
                    <Stack gap={12}>
                        <Button onClick={() => setLog('')}>
                            {'Clear log'}
                        </Button>
                    </Stack>
                    <Text
                        size="sm"
                        style={{
                            whiteSpace: 'pre-wrap',
                            overflowY: 'auto',
                            fontFamily: 'monospace',
                            flex: 1,
                            padding: 8,
                            borderRadius: 6,
                            border: '1px solid var(--mantine-color-gray-3)',
                        }}
                    >
                        {log || 'Whisper log is empty.'}
                    </Text>
                </Paper>
            </Collapse>
        </Stack>
    );
};
