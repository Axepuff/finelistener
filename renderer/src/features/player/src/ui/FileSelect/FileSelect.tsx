import AudioFileIcon from '@mui/icons-material/AudioFile';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useAtom } from 'jotai';
import { type FC } from 'react';
import { atoms } from 'renderer/src/atoms';
import { useApp } from '../../../../../AppContext';

export const FileSelect: FC = () => {
    const { isElectron } = useApp();
    const [audioToTranscribe, setAudioToTranscribe] = useAtom(atoms.transcription.audioToTranscribe);

    const handlePick = async () => {
        if (!isElectron) return;
        const file = await window.api!.pickAudio();

        if (!file) {
            return;
        }

        try {
            const { path } = await window.api!.convertAudio({ audioPath: file, lowPass: 12000, highPass: 80 });

            setAudioToTranscribe([path]);
        } catch (error) {
            console.error('Failed to convert audio', error);
        }
    };

    const selectedLabel =
        audioToTranscribe.length > 0 ? audioToTranscribe.join(', ') : 'Файл не выбран';

    return (
        <Stack direction="row" spacing={2} alignItems="center">
            <Button
                component="label"
                role={undefined}
                variant="contained"
                tabIndex={-1}
                onClick={handlePick}
                startIcon={<AudioFileIcon />}
            >
                {'Выбрать аудиофайл'}
            </Button>
            <Typography variant="subtitle2" sx={{ mt: 2, opacity: 0.7 }}>
                {selectedLabel}
            </Typography>
        </Stack>
    );
};
