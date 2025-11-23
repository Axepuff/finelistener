import AudioFileIcon from '@mui/icons-material/AudioFile';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useAtom } from 'jotai';
import { type FC } from 'react';
import { useApp } from '../../../../../AppContext';
import { atoms } from 'renderer/src/atoms';

export const FileSelect: FC = () => {
    const { isElectron } = useApp();
    const [audioToTranscribe, setAudioToTranscribe] = useAtom(atoms.transcription.audioToTranscribe);

    const handlePick = async () => {
        if (!isElectron) return;
        const file = await window.api!.pickAudio();

        if (file) setAudioToTranscribe([file]);
    };

    const selectedLabel =
        audioToTranscribe.length > 0 ? audioToTranscribe.join(', ') : 'Файл не выбран';

    return (
        <>
            <Typography variant="subtitle2" sx={{ mt: 2, opacity: 0.7 }}>
                {selectedLabel}
            </Typography>
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
        </>
    );
};
