import { Box, Button, Container, Grid, Stack } from '@mui/material';
import { Player } from '@~/player/lib';
import { ProcessLog } from '@~/process-log';
import { TranscribeControl } from '@~/transcribe-control';
import { TranscribedText } from '@~/transcribed-text';
import { useAtom, useSetAtom } from 'jotai';
import { useState } from 'react';
import { atoms, type RegionTiming } from 'renderer/src/atoms';

const { transcription, appState } = atoms;

export const Home = () => {
    const setUiState = useSetAtom(appState.uiState);

    const [regions, setRegions] = useAtom(transcription.regions);
    const [audioToTranscribe, setAudioToTranscribe] = useAtom(transcription.audioToTranscribe);
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
        <Container maxWidth="xl" sx={{ py: 4 }}>
            <Stack spacing="16px" sx={{ minHeight: '90vh' }}>
                <Player
                    onSetAudioToTranscribe={setAudioToTranscribe}
                />
                {/* <TranscribeState /> */}
                <Grid container={true} spacing="16px">
                    <Grid size={3}>
                        <TranscribeControl
                            regions={regions}
                            onTranscribeStart={handleTranscribeStart}
                            onTranscribeEnd={handleTranscribeEnd}
                        />
                    </Grid>
                    <Grid size={9}>
                        <TranscribedText
                            onSelectTime={handleSelectTime}
                        />
                    </Grid>
                </Grid>

            </Stack>
            <Box component="footer" sx={{ mt: 'auto' }}>
                <ProcessLog />
            </Box>
        </Container>
    );
};
