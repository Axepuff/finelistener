import { Box, Stack, Text, Title } from '@mantine/core';
import { FileSelect } from '@~/player';
import React from 'react';

// Centre of the workspace when no session is open. The import and record controls are the
// existing ones; their card layout from docs/design/screens/Empty.dc.html is a later step.
export const EmptyWorkspace: React.FC = () => (
    <Box
        h="100%"
        style={{
            overflow: 'auto',
            display: 'flex',
            justifyContent: 'center',
            padding: '48px 24px',
            background: 'var(--brand-color-bg-container)',
        }}
    >
        <Stack gap={32} w="100%" maw={720} my="auto">
            <Stack gap={8}>
                <Title order={1} fz={26} lh="34px" fw={600}>{'Record or import audio'}</Title>
                <Text c="var(--brand-color-text-secondary)" maw={560}>
                    {'FineListener turns speech into text, labels speakers and writes a summary. Runs offline. Audio never leaves this computer.'}
                </Text>
            </Stack>
            <FileSelect />
        </Stack>
    </Box>
);
