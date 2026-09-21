import { ActionIcon, Box, Button, Group, Loader, Paper, SegmentedControl, Text } from '@mantine/core';
import { IconPlayerPause, IconPlayerPlay } from '@tabler/icons-react';
import { WaveSurferAdapter } from '@~/player/src/ui/Player/WavesurfAdapter';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, type FC } from 'react';
import { useAppStore } from 'renderer/src/AppContext';
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

export const Player: FC = observer(() => {
    const store = useAppStore();
    const { workspace } = store;
    const containerRef = useRef<HTMLDivElement | null>(null);
    const adapterRef = useRef<PlayerAdapter | null>(null);
    const currentAudioPath = workspace.audioSourcePath ?? undefined;
    const segmentSelection = workspace.segmentSelection;

    useEffect(() => {
        const adapter = new WaveSurferAdapter(
            containerRef.current!,
            (isPlaying) => workspace.setPlaying(isPlaying),
            (isLoading) => workspace.setPlayerLoading(isLoading),
            (position) => workspace.setPlaybackPosition(position),
        );

        adapterRef.current = adapter;

        return () => {
            adapter.destroy();
            adapterRef.current = null;
        };
    }, [workspace]);

    const player = adapterRef.current;

    useEffect(() => {
        if (!player) return;

        workspace.clearSegment();
        workspace.setPlaybackPosition(0);

        if (!currentAudioPath) {
            workspace.setPlayerLoading(false);
            void player.loadSource(undefined);

            return;
        }

        workspace.setPlayerLoading(true);
        void player.loadSource(currentAudioPath);
    }, [currentAudioPath, player, workspace]);

    useEffect(() => {
        if (!player) return;

        if (!Number.isFinite(workspace.requestedPlaybackTime)) return;

        player.seekTo(workspace.requestedPlaybackTime);
        workspace.setPlaybackPosition(workspace.requestedPlaybackTime);
    }, [player, workspace, workspace.requestedPlaybackTime]);

    const onPlayPause = async () => {
        if (player) {
            await player.playPause();
        }
    };

    const handleMarkStart = () => {
        const safeTime = Math.max(0, player?.currentTime ?? 0);

        adapterRef.current?.setRegion({ start: safeTime });
        workspace.setSegmentStart(safeTime);
    };

    const handleMarkEnd = () => {
        const safeTime = Math.max(0, player?.currentTime ?? 0);

        adapterRef.current?.setRegion({ end: safeTime });
        workspace.setSegmentEnd(safeTime);
    };

    const handleClearRange = () => {
        workspace.clearSegment();
        adapterRef.current?.clearRegions();
    };

    const handleAudioModeChange = async (mode: string) => {
        if (mode !== 'original' && mode !== 'optimized') return;

        const result = await store.setAudioMode(mode);

        if (!result.ok) {
            store.activityLog.appendEvent(result.message);
        }
    };

    const selectedSegment = workspace.selectedSegment;
    const canMarkSegmentEnd = Boolean(
        currentAudioPath
        && segmentSelection?.start !== undefined
        && !store.operations.isBusy,
    );
    const selectionText = selectedSegment ?
        `Selected segment: ${formatPreciseTime(selectedSegment.start)} — ${formatPreciseTime(selectedSegment.end)}` :
        workspace.hasIncompleteSegment ?
            'Invalid selection range. End must be greater than start.' :
            'No selection. The whole file will be transcribed.';

    return (
        <Paper style={{ padding: 18 }}>
            <Box style={{ position: 'relative' }}>
                {workspace.isPlayerLoading ? <Loader style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} /> : null}
                <div ref={containerRef} />
            </Box>
            {workspace.activeSessionId !== null ? (
                <Group gap={8} align="center" mt={12}>
                    {store.operations.kind === 'optimizing-audio' ? (
                        <Group gap={8} align="center">
                            <Loader size={14} />
                            <Text size="sm" c="dimmed">{'Optimizing audio...'}</Text>
                        </Group>
                    ) : (
                        <SegmentedControl
                            size="xs"
                            value={workspace.audioMode}
                            data={AUDIO_MODE_OPTIONS}
                            onChange={(value) => void handleAudioModeChange(value)}
                            disabled={store.operations.isBusy}
                        />
                    )}
                </Group>
            ) : null}
            <Group gap={12} align="center" mt={12}>
                <ActionIcon onClick={onPlayPause} variant="subtle">
                    {workspace.isPlaying ? <IconPlayerPause size={16} /> : <IconPlayerPlay size={16} />}
                </ActionIcon>
                <Text size="sm">
                    {'Current position: '}
                    {formatPreciseTime(workspace.playbackPosition)}
                </Text>
            </Group>

            <Group gap={8} mt={12} style={{ flexWrap: 'wrap' }}>
                <Button
                    variant="outline"
                    onClick={handleMarkStart}
                    disabled={!currentAudioPath || store.operations.isBusy}
                >
                    {'Mark start'}
                </Button>
                <Button
                    variant="outline"
                    onClick={handleMarkEnd}
                    disabled={!canMarkSegmentEnd}
                >
                    {'Mark end'}
                </Button>
                <Button
                    variant="subtle"
                    onClick={handleClearRange}
                    disabled={!segmentSelection || store.operations.isBusy}
                >
                    {'Clear selection'}
                </Button>
            </Group>

            <Text size="sm" mt={8}>
                {selectionText}
            </Text>
        </Paper>
    );
});
