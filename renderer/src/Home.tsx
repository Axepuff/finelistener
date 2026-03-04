import { Box, Divider, Paper, ScrollArea, Stack } from '@mantine/core';
import { FileSelect, Player } from '@~/player';
import { ProcessLog } from '@~/process-log';
import { SessionsSidebar } from '@~/sessions';
import { TranscribeControl } from '@~/transcribe-control';
import { TranscribedText } from '@~/transcribed-text';
import { useAtomValue } from 'jotai';
import { useSetAtom } from 'jotai';
import React, { useEffect } from 'react';
import { atoms, type RegionTiming } from 'renderer/src/atoms';
import { ResizableSidebarLayout } from 'renderer/src/shared/lib';

const { transcription, appState } = atoms;
const SIDEBAR_MIN_WIDTH = 320;
const SIDEBAR_MAX_WIDTH = 560;
const SIDEBAR_DEFAULT_WIDTH = 420;
const RIGHT_SIDEBAR_MIN_WIDTH = 260;
const RIGHT_SIDEBAR_MAX_WIDTH = 520;
const RIGHT_SIDEBAR_DEFAULT_WIDTH = 360;

export const Home: React.FC = () => {
    const sessions = useAtomValue(atoms.sessions.items);
    const setUiState = useSetAtom(appState.uiState);
    const setTranscribedRegions = useSetAtom(transcription.transcribedRegions);
    const setCurrentTime = useSetAtom(transcription.currentTime);
    const refreshSessions = useSetAtom(atoms.refreshSessions);

    useEffect(() => {
        void refreshSessions();
    }, [refreshSessions]);

    const handleTranscribeStart = () => {
        setUiState('transcribing');
    };

    const handleTranscribeEnd = (endRegions?: RegionTiming) => {
        setUiState('ready');
        setTranscribedRegions(endRegions);
    };

    const handleSelectTime = (time: number) => {
        setCurrentTime(time);
    };

    return (
        <Box style={{ height: '100vh', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
                                        <TranscribeControl
                                            onTranscribeStart={handleTranscribeStart}
                                            onTranscribeEnd={handleTranscribeEnd}
                                        />
                                    </Stack>
                                </ScrollArea>
                            </Paper>
                        ),
                    }}
                    rightSidebar={sessions.length ? {
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
                                <TranscribedText
                                    onSelectTime={handleSelectTime}
                                />
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
};
