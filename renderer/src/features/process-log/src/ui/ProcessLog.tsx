import { Button, Collapse, Paper, Stack, Switch, Text } from '@mantine/core';
import { observer } from 'mobx-react-lite';
import { FC, useState } from 'react';
import { useAppStore } from 'renderer/src/AppContext';

export const ProcessLog: FC = observer(() => {
    const { activityLog } = useAppStore();
    const [showLog, setShowLog] = useState(false);

    return (
        <Stack gap={8} p={8}>
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
                        <Button onClick={() => activityLog.clear()}>
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
                        {activityLog.content || 'Whisper log is empty.'}
                    </Text>
                </Paper>
            </Collapse>
        </Stack>
    );
});
