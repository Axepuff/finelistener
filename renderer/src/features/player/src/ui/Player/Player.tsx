import AddIcon from '@mui/icons-material/Add';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useCallback, useState, type FC } from 'react';
import type { RegionTiming } from 'renderer/src/atoms';
import { atom, computed, effect, useStore } from '../../../../../reactive';

type PlayerProps = {
    onSetAudioToTranscribe: (path: string[]) => void;
    onSetRegions: (regions: RegionTiming) => void;
};

export const Player: FC<PlayerProps> = ({ onSetAudioToTranscribe, onSetRegions }) => {
    const [audioPath, setAudioPath] = useState('');

    const handlePick = useCallback(async () => {
        if (!window.api) return;

        const file = await window.api.pickAudio();

        if (!file) return;

        setAudioPath(file);
        onSetAudioToTranscribe?.([file]);
    }, [onSetAudioToTranscribe]);

    return (
        <Paper variant="outlined" sx={{ p: 3 }}>
            <Stack direction="row" spacing={2} alignItems="center">
                <Button variant="contained" startIcon={<AddIcon />} onClick={handlePick}>
                    {'Добавить аудио'}
                </Button>
                <Typography variant="body2" sx={{ opacity: 0.7 }}>
                    {audioPath || 'Файл не выбран'}
                </Typography>
            </Stack>
        </Paper>
    );
};
