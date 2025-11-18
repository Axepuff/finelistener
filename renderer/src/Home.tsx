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
    const [audioToTranscribe, setAudioToTranscribe] = useState<string[]>([]);
    const [regions, setRegions] = useAtom(transcription.regions);
    const setTranscribedRegions = useSetAtom(transcription.transcribedRegions);
    const setCurrentTime = useSetAtom(transcription.currentTime);
    const resetTranscriptionState = useSetAtom(atoms.reset);

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

    const handleClear = () => {
        setAudioToTranscribe([]);
        resetTranscriptionState();
    };

    return (
        <Container maxWidth="xl" sx={{ py: 4 }}>
            <Stack spacing="16px" sx={{ minHeight: '90vh' }}>
                <Button variant="outlined" onClick={handleClear}>{'Очистить'}</Button>
                <Player
                    onSetAudioToTranscribe={setAudioToTranscribe}
                    onSetRegions={setRegions}
                />
                {/* <TranscribeState /> */}
                <Grid container={true} spacing="16px">
                    <Grid size={3}>
                        <TranscribeControl
                            regions={regions}
                            audioToTranscribe={audioToTranscribe}
                            onTranscribeStart={handleTranscribeStart}
                            onTranscribeEnd={handleTranscribeEnd}
                            // onTranscribeProgress={handleTranscribeProgress}
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
