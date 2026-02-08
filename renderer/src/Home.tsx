import { Box, Container, Grid, Stack } from '@mantine/core';
import { FileSelect, Player } from '@~/player';
import { ProcessLog } from '@~/process-log';
import { TranscribeControl } from '@~/transcribe-control';
import { TranscribedText } from '@~/transcribed-text';
import { useSetAtom } from 'jotai';
import { atoms, type RegionTiming } from 'renderer/src/atoms';

const { transcription, appState } = atoms;

export const Home = () => {
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
        <Container size="xl" py={32}>
            <Stack gap={16} style={{ minHeight: '90vh' }}>
                <FileSelect />
                <Player />
                {/* <TranscribeState /> */}
                <Grid gutter={16}>
                    <Grid.Col span={3}>
                        <TranscribeControl
                            onTranscribeStart={handleTranscribeStart}
                            onTranscribeEnd={handleTranscribeEnd}
                        />
                    </Grid.Col>
                    <Grid.Col span={9}>
                        <TranscribedText
                            onSelectTime={handleSelectTime}
                        />
                    </Grid.Col>
                </Grid>

            </Stack>
            <Box component="footer" mt="auto">
                <ProcessLog />
            </Box>
        </Container>
    );
};
