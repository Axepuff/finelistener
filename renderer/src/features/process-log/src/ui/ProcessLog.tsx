import { Button, Group, Stack, Text } from '@mantine/core';
import { observer } from 'mobx-react-lite';
import { type FC, useEffect, useRef } from 'react';
import { useAppStore } from 'renderer/src/AppContext';

export const ProcessLog: FC = observer(() => {
    const { activityLog } = useAppStore();
    const contentRef = useRef<HTMLParagraphElement>(null);
    const { focusRequest } = activityLog;
    useEffect(() => {
        if (contentRef.current) contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }, [focusRequest]);

    return (
        <Stack gap={8} p={12} h="100%" style={{ minHeight: 0 }}>
            <Group justify="space-between" align="center" wrap="nowrap">
                <Text size="sm" fw={600}>{'Log'}</Text>
                <Button size="xs" variant="default" onClick={() => activityLog.clear()}>
                    {'Clear log'}
                </Button>
            </Group>
            <Text
                ref={contentRef}
                size="sm"
                style={{
                    whiteSpace: 'pre-wrap',
                    overflowY: 'auto',
                    fontFamily: 'var(--brand-font-family-code)',
                    flex: 1,
                    minHeight: 0,
                    padding: 8,
                    borderRadius: 6,
                    border: 'var(--brand-line-width) solid var(--brand-color-border)',
                }}
            >
                {activityLog.content || 'Whisper log is empty.'}
            </Text>
        </Stack>
    );
});
