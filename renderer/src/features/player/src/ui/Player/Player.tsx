import { Pause, PlayArrow } from '@mui/icons-material';
import { Box, Button, CircularProgress, IconButton, Stack, Typography } from '@mui/material';
import Paper from '@mui/material/Paper';
import { useAtom, useAtomValue } from 'jotai';
import { useEffect, useMemo, useRef, useState, type FC } from 'react';
import { atoms } from 'renderer/src/atoms';
import { PlayerAdapter, WindsurfAdapter } from './PlayerAdapter';

const formatPreciseTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '00:00.00';

    const minutes = Math.floor(seconds / 60);
    const secs = seconds - minutes * 60;

    return `${String(minutes).padStart(2, '0')}:${secs.toFixed(2).padStart(5, '0')}`;
};

export const Player: FC = () => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const adapterRef = useRef<PlayerAdapter | null>(null);
    const [urlIndex, setUrlIndex] = useState(0);
    const audioToTranscribe = useAtomValue(atoms.transcription.audioToTranscribe);
    const selectedTime = useAtomValue(atoms.transcription.currentTime);
    const [trimRange, setTrimRange] = useAtom(atoms.transcription.trimRange); // TODO в локальные атомы локального стора плеера.
    const [isPlaying, setIsPlaying] = useAtom(atoms.player.isPlaying);
    const [isLoading, setIsLoading] = useState(false);
    const [currentPosition, setCurrentPosition] = useState(0);

    useEffect(() => {
        setUrlIndex((index) => Math.min(index, Math.max(audioToTranscribe.length - 1, 0)));
    }, [audioToTranscribe.length]);

    const currentAudioPath = useMemo(() => {
        if (audioToTranscribe.length === 0) return undefined;

        return audioToTranscribe[Math.min(urlIndex, audioToTranscribe.length - 1)];
    }, [audioToTranscribe, urlIndex]);

    useEffect(() => {
        const adapter = new WindsurfAdapter(containerRef.current!, setIsPlaying, setIsLoading, setCurrentPosition);

        adapterRef.current = adapter;

        return () => {
            adapter.destroy();
            adapterRef.current = null;
        };
    }, [setIsPlaying, setIsLoading, setCurrentPosition]);

    const player = adapterRef.current;

    useEffect(() => {
        if (!player) return;

        setTrimRange(undefined);
        setIsLoading(true);
        setCurrentPosition(0);
        void player.loadSource(currentAudioPath);
    }, [currentAudioPath, player, setCurrentPosition, setTrimRange]);

    useEffect(() => {
        if (!player) return;

        if (!Number.isFinite(selectedTime)) return;

        player.seekTo(selectedTime);
        setCurrentPosition(selectedTime);
    }, [player, selectedTime, setCurrentPosition]);

    const onPlayPause = async () => {
        if (player) {
            await player.playPause();
        }
    };

    const handleMarkStart = () => {
        const safeTime = Math.max(0, player?.currentTime ?? 0);

        adapterRef.current?.setRegion({ start: safeTime });
        setTrimRange((prev) => ({ start: safeTime, end: prev?.end }));
    };

    const handleMarkEnd = () => {
        const safeTime = Math.max(0, player?.currentTime ?? 0);

        adapterRef.current?.setRegion({ end: safeTime });
        setTrimRange((prev) => ({ start: prev?.start, end: safeTime }));
    };

    const handleClearRange = () => {
        setTrimRange(undefined);
        adapterRef.current?.setRegion({ start: 0, end: 1 });
    };

    const isRangeValid = useMemo(() => {
        if (!trimRange) return false;

        const { start, end } = trimRange;

        return Number.isFinite(start) && Number.isFinite(end) && typeof start === 'number' && typeof end === 'number' && end > start;
    }, [trimRange]);

    const selectionText = useMemo(() => {
        if (isRangeValid && trimRange) {
            return `Будет распознан фрагмент ${formatPreciseTime(trimRange.start!)} — ${formatPreciseTime(trimRange.end!)}`;
        }

        if (trimRange?.start !== undefined || trimRange?.end !== undefined) {
            return 'Диапазон отмечен некорректно. Конец должен быть позже начала.';
        }

        return 'Фрагмент не выбран, будет распознан весь файл.';
    }, [isRangeValid, trimRange]);

    return (
        <Paper variant="outlined" sx={{ p: 3 }}>
            <Box sx={{ position: 'relative' }}>
                {isLoading ? <CircularProgress sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} /> : null}
                <div ref={containerRef} />
            </Box>
            <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 2 }}>
                <IconButton onClick={onPlayPause}>
                    {isPlaying ? <Pause /> : <PlayArrow />}
                </IconButton>
                <Typography variant="body2">
                    {'Текущая позиция: '}
                    {formatPreciseTime(currentPosition)}
                </Typography>
            </Stack>

            <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap' }}>
                <Button variant="outlined" onClick={handleMarkStart} disabled={!currentAudioPath}>
                    {'Отметить начало'}
                </Button>
                <Button
                    variant="outlined"
                    onClick={handleMarkEnd}
                    disabled={!currentAudioPath || trimRange?.start === undefined}
                >
                    {'Отметить конец'}
                </Button>
                <Button variant="text" onClick={handleClearRange} disabled={!trimRange}>
                    {'Сбросить выделение'}
                </Button>
            </Stack>

            <Typography variant="body2" sx={{ mt: 1 }}>
                {selectionText}
            </Typography>
        </Paper>
    );
};
