import { Box, Divider, LoadingOverlay, Paper, ScrollArea, Stack } from '@mantine/core';
import { FileSelect, Player } from '@~/player';
import { ProcessLog } from '@~/process-log';
import { SessionsSidebar } from '@~/sessions';
import { TranscribeControl } from '@~/transcribe-control';
import { TranscribedText } from '@~/transcribed-text';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { useAppStore } from 'renderer/src/AppContext';
import { ResizableSidebarLayout } from 'renderer/src/shared/lib';

const SIDEBAR_MIN_WIDTH = 10;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_DEFAULT_WIDTH = 300;
const RIGHT_SIDEBAR_MIN_WIDTH = 10;
const RIGHT_SIDEBAR_MAX_WIDTH = 480;
const RIGHT_SIDEBAR_DEFAULT_WIDTH = 360;

export const Home: React.FC = observer(() => {
    const store = useAppStore();
    const { sessions } = store;

    return (
        <Box style={{ height: '100vh', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
            <LoadingOverlay visible={store.lifecycleState === 'importing'} overlayProps={{ blur: 2 }} />
            <Stack gap={0} style={{ minHeight: 0, display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                <Player />
                <Divider />
                <ResizableSidebarLayout
                    leftSidebar={{
                        minWidth: SIDEBAR_MIN_WIDTH,
                        maxWidth: SIDEBAR_MAX_WIDTH,
                        defaultWidth: SIDEBAR_DEFAULT_WIDTH,
                        widthPreferenceKey: 'homeSidebarWidth',
                        separatorAriaLabel: 'Resize left sidebar',
                        node: (
                            <Paper
                                bg="gray.0"
                                h="100%"
                                style={{ minHeight: 0, overflow: 'hidden' }}
                            >
                                <ScrollArea h="100%" type="auto" style={{ minHeight: 0 }}>
                                    <Stack gap={16} p={16}>
                                        <FileSelect />
                                        <TranscribeControl />
                                    </Stack>
                                </ScrollArea>
                            </Paper>
                        ),
                    }}
                    rightSidebar={sessions.items.length ? {
                        minWidth: RIGHT_SIDEBAR_MIN_WIDTH,
                        maxWidth: RIGHT_SIDEBAR_MAX_WIDTH,
                        defaultWidth: RIGHT_SIDEBAR_DEFAULT_WIDTH,
                        widthPreferenceKey: 'homeRightSidebarWidth',
                        separatorAriaLabel: 'Resize right sidebar',
                        node: (
                            <SessionsSidebar />
                        ),
                    } : undefined}
                    content={(
                        <Box style={{ minWidth: 0, minHeight: 0, height: '100%', display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden' }}>
                            <Box style={{ minHeight: 0, flex: 1, overflow: 'hidden' }}>
                                <TranscribedText />
                            </Box>
                        </Box>
                    )}
                />
                <Divider />
                <Box component="footer">
                    <ProcessLog />
                </Box>
                {/* <TranscribeState /> */}
            </Stack>
        </Box>
    );
});
