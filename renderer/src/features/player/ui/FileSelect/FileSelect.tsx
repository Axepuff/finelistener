import { Group } from '@mui/icons-material';
import AudioFileIcon from '@mui/icons-material/AudioFile';
import Button from '@mui/material/Button';
import { styled } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import { useState, type FC } from 'react';
import { useApp } from '../../../../AppContext';

const VisuallyHiddenInput = styled('input')({
    clip: 'rect(0 0 0 0)',
    clipPath: 'inset(50%)',
    height: 1,
    overflow: 'hidden',
    position: 'absolute',
    bottom: 0,
    left: 0,
    whiteSpace: 'nowrap',
    width: 1,
});

type Props = {
    onChange: (files: HTMLInputElement['files']) => void;
};

export const InputFileUpload: FC<Props> = ({ onChange }) => {
    const isElectron = useApp();
    const [audioPath, setAudioPath] = useState<string>('');

    const handlePick = async () => {
        if (!isElectron) return;
        const file = await window.api!.pickAudio();

        if (file) setAudioPath(file);
    };

    return (
        <Group>
            <Typography variant="subtitle2" sx={{ mt: 2, opacity: 0.7 }}>
                {audioPath || 'Файл не выбран'}
            </Typography>
            <Button
                component="label"
                role={undefined}
                variant="contained"
                tabIndex={-1}
                startIcon={<AudioFileIcon />}
            >
                {'Выберите файл'}
                <VisuallyHiddenInput
                    type="file"
                    onChange={(event) => onChange(event.target.files)}
                />
            </Button>
        </Group>
    );
};
