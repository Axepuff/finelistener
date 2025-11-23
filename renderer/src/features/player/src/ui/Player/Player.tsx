import { Pause, PlayArrow } from '@mui/icons-material';
import { Button, IconButton } from '@mui/material';
import Paper from '@mui/material/Paper';
import { useWavesurfer } from '@wavesurfer/react';
import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react';
import { atoms } from 'renderer/src/atoms';
import Timeline from 'wavesurfer.js/dist/plugins/timeline.esm.js';

const LOCAL_FILE_PROTOCOL = 'local-file';

const formatTime = (seconds: number) => [seconds / 60, seconds % 60].map((v) => `0${Math.floor(v)}`.slice(-2)).join(':');

const buildLocalFileUrl = (filePath: string): string => {
    if (!filePath) return '';

    const normalizedPath = filePath.replace(/\\/g, '/');

    const withLeadingSlash = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;

    return `${LOCAL_FILE_PROTOCOL}://${encodeURI(withLeadingSlash)}`;
};

export const Player: FC = () => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [urlIndex, setUrlIndex] = useState(0);
    const audioToTranscribe = useAtomValue(atoms.transcription.audioToTranscribe);

    useEffect(() => {
        setUrlIndex((index) => Math.min(index, Math.max(audioToTranscribe.length - 1, 0)));
    }, [audioToTranscribe.length]);

    const currentAudioPath = useMemo(() => {
        if (audioToTranscribe.length === 0) return undefined;

        return audioToTranscribe[Math.min(urlIndex, audioToTranscribe.length - 1)];
    }, [audioToTranscribe, urlIndex]);

    const { wavesurfer, isPlaying, currentTime } = useWavesurfer({
        container: containerRef,
        height: 100,
        waveColor: 'rgba(132, 180, 142, 1)',
        progressColor: 'rgba(28, 77, 5, 1)',
        plugins: useMemo(() => [Timeline.create()], []),
    });

    useEffect(() => {
        if (!currentAudioPath) return undefined;

        void wavesurfer?.load(buildLocalFileUrl(currentAudioPath));
    }, [currentAudioPath, wavesurfer]);

    const onPlayPause = useCallback(async () => {
        if (wavesurfer) {
            await wavesurfer.playPause();
        }
    }, [wavesurfer]);

    return (
        <Paper variant="outlined" sx={{ p: 3 }}>
            <div ref={containerRef} />

            <p>
                {'Текущее время: '}
                {formatTime(currentTime)}
            </p>

            <IconButton onClick={onPlayPause}>
                {isPlaying ? <Pause /> :  <PlayArrow />}
            </IconButton>

        </Paper>
    );
};
