import { ActionIcon, Box, Button, Group, Loader, Paper, SegmentedControl, Text } from '@mantine/core';
import { IconPlayerPause, IconPlayerPlay } from '@tabler/icons-react';
import { WaveSurferAdapter } from '@~/player/src/ui/Player/WavesurfAdapter';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useMemo, useRef, useState, type FC } from 'react';
import { atoms } from 'renderer/src/atoms';
import { PlayerAdapter } from './PlayerAdapter';

const formatPreciseTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '00:00.00';

    const minutes = Math.floor(seconds / 60);
    const secs = seconds - minutes * 60;

    return `${String(minutes).padStart(2, '0')}:${secs.toFixed(2).padStart(5, '0')}`;
};

const AUDIO_MODE_OPTIONS = [
    { label: 'Original', value: 'original' },
    { label: 'Optimized', value: 'optimized' },
];

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
    const currentSessionId = useAtomValue(atoms.sessions.currentSessionId);
    const [currentSessionDetails, setCurrentSessionDetails] = useAtom(atoms.sessions.currentSessionDetails);
    const [audioMode, setAudioMode] = useAtom(atoms.sessions.audioMode);
    const setAudioToTranscribe = useSetAtom(atoms.transcription.audioToTranscribe);
    const [isOptimizing, setIsOptimizing] = useState(false);

    useEffect(() => {
        setUrlIndex((index) => Math.min(index, Math.max(audioToTranscribe.length - 1, 0)));
    }, [audioToTranscribe.length]);

    const currentAudioPath = useMemo(() => {
        if (audioToTranscribe.length === 0) return undefined;

        return audioToTranscribe[Math.min(urlIndex, audioToTranscribe.length - 1)];
    }, [audioToTranscribe, urlIndex]);

    useEffect(() => {
        const adapter = new WaveSurferAdapter(containerRef.current!, setIsPlaying, setIsLoading, setCurrentPosition);

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
        adapterRef.current?.clearRegions();
    };

    const handleAudioModeChange = async (mode: string) => {
        if (!currentSessionId || !currentSessionDetails) return;

        if (mode === 'original') {
            setAudioMode('original');
            setAudioToTranscribe([currentSessionDetails.audioWavPath]);

            return;
        }

        if (mode === 'optimized') {
            if (currentSessionDetails.audioOptimizedWavPath) {
                setAudioMode('optimized');
                setAudioToTranscribe([currentSessionDetails.audioOptimizedWavPath]);

                return;
            }

            setIsOptimizing(true);

            try {
                const updated = await window.api!.sessions.optimizeAudio(currentSessionId);

                setCurrentSessionDetails(updated);
                setAudioMode('optimized');
                setAudioToTranscribe([updated.audioOptimizedWavPath!]);
            } catch (error) {
                console.error('Failed to optimize audio', error);
            } finally {
                setIsOptimizing(false);
            }
        }
    };

    const isRangeValid = useMemo(() => {
        if (!trimRange) return false;

        const { start, end } = trimRange;

        return Number.isFinite(start) && Number.isFinite(end) && typeof start === 'number' && typeof end === 'number' && end > start;
    }, [trimRange]);

    const selectionText = useMemo(() => {
        if (isRangeValid && trimRange) {
            return `Selected segment: ${formatPreciseTime(trimRange.start!)} — ${formatPreciseTime(trimRange.end!)}`;
        }

        if (trimRange?.start !== undefined || trimRange?.end !== undefined) {
            return 'Invalid selection range. End must be greater than start.';
        }

        return 'No selection. The whole file will be transcribed.';
    }, [isRangeValid, trimRange]);

    return (
        <Paper style={{ padding: 18 }}>
            <Box style={{ position: 'relative' }}>
                {isLoading ? <Loader style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} /> : null}
                <div ref={containerRef} />
            </Box>
            {currentSessionId !== null ? (
                <Group gap={8} align="center" mt={12}>
                    {isOptimizing ? (
                        <Group gap={8} align="center">
                            <Loader size={14} />
                            <Text size="sm" c="dimmed">{'Optimizing audio...'}</Text>
                        </Group>
                    ) : (
                        <SegmentedControl
                            size="xs"
                            value={audioMode}
                            data={AUDIO_MODE_OPTIONS}
                            onChange={(value) => void handleAudioModeChange(value)}
                        />
                    )}
                </Group>
            ) : null}
            <Group gap={12} align="center" mt={12}>
                <ActionIcon onClick={onPlayPause} variant="subtle">
                    {isPlaying ? <IconPlayerPause size={16} /> : <IconPlayerPlay size={16} />}
                </ActionIcon>
                <Text size="sm">
                    {'Current position: '}
                    {formatPreciseTime(currentPosition)}
                </Text>
            </Group>

            <Group gap={8} mt={12} style={{ flexWrap: 'wrap' }}>
                <Button variant="outline" onClick={handleMarkStart} disabled={!currentAudioPath}>
                    {'Mark start'}
                </Button>
                <Button
                    variant="outline"
                    onClick={handleMarkEnd}
                    disabled={!currentAudioPath || trimRange?.start === undefined}
                >
                    {'Mark end'}
                </Button>
                <Button variant="subtle" onClick={handleClearRange} disabled={!trimRange}>
                    {'Clear selection'}
                </Button>
            </Group>

            <Text size="sm" mt={8}>
                {selectionText}
            </Text>
        </Paper>
    );
};
