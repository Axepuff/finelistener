import { Box, Divider, Paper, ScrollArea, Stack, Text } from '@mantine/core';
import { FileSelect, Player } from '@~/player';
import { ProcessLog } from '@~/process-log';
import { TranscribeControl } from '@~/transcribe-control';
import { TranscribedText } from '@~/transcribed-text';
import { useSetAtom } from 'jotai';
import React from 'react';
import { atoms, type RegionTiming } from 'renderer/src/atoms';
import { ResizableSidebarLayout } from 'renderer/src/shared/lib';

const { transcription, appState } = atoms;
const SIDEBAR_MIN_WIDTH = 320;
const SIDEBAR_MAX_WIDTH = 560;
const SIDEBAR_DEFAULT_WIDTH = 420;

export const Home: React.FC = () => {
    const setUiState = useSetAtom(appState.uiState);
    const setTranscribedRegions = useSetAtom(transcription.transcribedRegions);
    const setCurrentTime = useSetAtom(transcription.currentTime);

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
        <Box style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Stack gap={0} style={{ minHeight: 0, display: 'flex', flexDirection: 'column', flex: 1 }}>
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
                                style={{
                                    height: '100%',
                                    overflow: 'hidden',
                                    display: 'flex',
                                    flexDirection: 'column',
                                }}
                            >
                                <ScrollArea style={{ height: '100%' }} scrollbarSize={8}>
                                    <Stack gap={16} p={16}>
                                        <Text size="xs" fw={700} c="dimmed" style={{ letterSpacing: '0.08em' }}>
                                            {'SOURCE'}
                                        </Text>
                                        <FileSelect />
                                        <Text size="xs" fw={700} c="dimmed" style={{ letterSpacing: '0.08em' }}>
                                            {'CONFIGURATION'}
                                        </Text>
                                        <TranscribeControl
                                            onTranscribeStart={handleTranscribeStart}
                                            onTranscribeEnd={handleTranscribeEnd}
                                        />
                                    </Stack>
                                </ScrollArea>
                            </Paper>
                        ),
                    }}
                    content={(
                        <Box style={{ minWidth: 0, minHeight: 0, height: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <Box style={{ minHeight: 0, flex: 1 }}>
                                <TranscribedText
                                    onSelectTime={handleSelectTime}
                                />
                            </Box>
                        </Box>
                    )}
                />

                <Box component="footer">
                    <ProcessLog />
                </Box>
                {/* <TranscribeState /> */}
            </Stack>
        </Box>
    );
};
