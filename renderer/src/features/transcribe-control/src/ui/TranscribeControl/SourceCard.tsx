import { Box, Button, Group, Stack, Text } from '@mantine/core';
import { IconFileMusic } from '@tabler/icons-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { useAppStore } from '../../../../../AppContext';

export const SourceCard: React.FC = observer(() => {
    const store = useAppStore();
    const session = store.workspace.activeSession;
    const info = session?.sourceMetadata;
    const seconds = info?.durationMs !== undefined ? Math.floor(info.durationMs / 1000) : null;
    const metadata = [
        seconds !== null ? `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : null,
        info?.sampleRate ? `${info.sampleRate / 1000} kHz` : null,
        info?.channels ? info.channels === 1 ? 'mono' : info.channels === 2 ? 'stereo' : `${info.channels} channels` : null,
    ].filter(Boolean).join(' · ');
    const fileName = session?.sourceFileName ?? session?.audioOriginalPath.split(/[/\\]/).pop();
    return (
        <Group className="settings-source" gap={10} wrap="nowrap" align="center">
            <Box className="settings-source__icon"><IconFileMusic size={18} aria-hidden="true" /></Box>
            <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
                <Text size="sm" fw={600} truncate="end" title={fileName}>{fileName ?? 'No source selected'}</Text>
                <Text size="xs" c="dimmed" ff="var(--brand-font-family-code)">{metadata || 'Source details unavailable'}</Text>
            </Stack>
            <Button variant="subtle" size="compact-xs" className="settings-link" disabled={store.operations.isBusy}
                onClick={() => { void store.importAudio().then((result) => { if (!result.ok) store.activityLog.appendEvent(result.message); }); }}>Replace</Button>
        </Group>
    );
});
