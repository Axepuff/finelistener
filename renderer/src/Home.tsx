import { Group, Transcribe } from '@mui/icons-material';
import { Container, Stack } from '@mui/material';
import { useState } from 'react';

type UiState = 'initial' | 'transcribing' | 'ready';
type RegionTiming = { start: number; end: number };

export const Home = () => {
    const [uiState, setUiState] = useState<UiState>();
    const [audioToTranscribe, setAudioToTranscribe] = useState<string[]>([]);
    const [regions, setRegions] = useState<RegionTiming>();
    const [transcribedRegions, setTranscribedRegions] = useState<RegionTiming>();
    const [currentTime, setCurrentTime] = useState(0);
    const [text, setText] = useState('');

    const handleTranscribeStart = () => {
        setUiState('transcribing');
    };

    const handleTranscribeProgress = (chunk: string) => {
        setText((t) => t + chunk);
    };

    const handleTranscribeEnd = (endRegions: RegionTiming) => {
        setUiState('ready');
        setTranscribedRegions(endRegions);
    };

    const handleSelectTime = (time: number) => {
        setCurrentTime(time);
    };

    return (
        <Container maxWidth="md">
            <Stack>
                <Player
                    onSetAudioToTranscribe={setAudioToTranscribe}
                    onSetRegions={setRegions}
                />
                <Group>
                    <TranscribeControl
                        audioToTranscribe={audioToTranscribe}
                        onTranscribeStart={handleTranscribeStart}
                        onTranscribeEnd={handleTranscribeEnd}
                        onTranscribeProgress={handleTranscribeProgress}
                    />
                    <TranscribedText
                        text={text}
                        onSelectTime={handleSelectTime}
                    />
                </Group>
            </Stack>
        </Container>
    );
};
