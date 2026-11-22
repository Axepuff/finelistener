import { ActionIcon, Box, Button, Divider, Group, Loader, SegmentedControl, Text } from '@mantine/core';
import { IconBracketsContainStart, IconBracketsContainEnd, IconPlayerPauseFilled, IconPlayerPlayFilled, IconX } from '@tabler/icons-react';
import { WaveSurferAdapter } from '@~/player/src/ui/Player/WavesurfAdapter';
import { reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from 'renderer/src/AppContext';
import { PlayerAdapter } from './PlayerAdapter';
import { formatPreciseTime } from './formatPreciseTime';
import './Player.css';

const AUDIO_MODE_OPTIONS = [
    { label: 'Original', value: 'original' },
    { label: 'Optimized', value: 'optimized' },
];

export const Player: React.FC = observer(() => {
    const store = useAppStore();
    const { workspace } = store;
    const containerRef = useRef<HTMLDivElement | null>(null);
    const adapterRef = useRef<PlayerAdapter | null>(null);
    const [duration, setDuration] = useState(0);
    const currentAudioPath = workspace.audioSourcePath ?? undefined;
    const activeSession = workspace.activeSession;
    const segmentSelection = workspace.segmentSelection;

    useEffect(() => {
        const adapter = new WaveSurferAdapter(
            containerRef.current!,
            (isPlaying) => workspace.setPlaying(isPlaying),
            (isLoading) => {
                workspace.setPlayerLoading(isLoading);
                if (!isLoading) setDuration(adapterRef.current?.duration ?? 0);
            },
            (position) => workspace.setPlaybackPosition(position),
        );

        adapterRef.current = adapter;

        return () => {
            adapter.destroy();
            adapterRef.current = null;
        };
    }, [workspace]);

    useEffect(() => {
        const player = adapterRef.current;
        if (!player) return;

        workspace.clearSegment();
        workspace.setPlaybackPosition(0);
        setDuration(0);

        if (!activeSession || !currentAudioPath) {
            workspace.setPlayerLoading(false);
            void player.loadSource(undefined);

            return;
        }

        workspace.setPlayerLoading(true);
        void player.loadSource(currentAudioPath);
    }, [activeSession, currentAudioPath, workspace]);

    useEffect(() => reaction(
        () => workspace.hasAudioSource && !workspace.isPlayerLoading ? workspace.playbackRequest : null,
        (request) => {
            const player = adapterRef.current;
            if (!player || !request) return;
            workspace.clearPlaybackRequest();
            player.seekTo(request.time);
            if (request.action === 'play' && !player.isPlaying) {
                void player.playPause().catch((error: unknown) => console.error('Failed to play transcript audio', error));
            }
        },
        { fireImmediately: true },
    ), [workspace]);

    const onPlayPause = async () => {
        await adapterRef.current?.playPause();
    };

    const handleMarkStart = () => {
        const safeTime = Math.max(0, adapterRef.current?.currentTime ?? 0);

        adapterRef.current?.setRegion({ start: safeTime });
        workspace.setSegmentStart(safeTime);
    };

    const handleMarkEnd = () => {
        const safeTime = Math.max(0, adapterRef.current?.currentTime ?? 0);

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

    const canMarkSegmentEnd = Boolean(
        currentAudioPath
        && segmentSelection?.start !== undefined
        && !store.operations.isBusy,
    );
    const hasInvalidSegment = segmentSelection?.end !== undefined && !workspace.selectedSegment;
    const selectionText = segmentSelection ?
        hasInvalidSegment ?
            'Invalid segment: end must follow start' :
            `Segment ${formatPreciseTime(segmentSelection.start ?? 0)} — ${segmentSelection.end === undefined ? '…' : formatPreciseTime(segmentSelection.end)}` : null;

    return (
        <Box className="player-strip">
            <Group className="player-strip__controls" gap={12} align="center" wrap="nowrap">
                <ActionIcon onClick={onPlayPause} size={32} radius={32} variant="filled" disabled={!currentAudioPath || workspace.isPlayerLoading} aria-label={workspace.isPlaying ? 'Pause audio' : 'Play audio'}>
                    {workspace.isPlaying ? <IconPlayerPauseFilled size={16} /> : <IconPlayerPlayFilled size={16} />}
                </ActionIcon>
                <Text className="player-strip__time" size="sm" ff="var(--brand-font-family-code)" aria-label={`Current position: ${formatPreciseTime(workspace.playbackPosition)} / ${formatPreciseTime(duration)}`}>
                    <span style={{ fontWeight: 600 }}>{formatPreciseTime(workspace.playbackPosition)}</span>
                    <span style={{ color: 'var(--brand-color-text-secondary)' }}>{` / ${formatPreciseTime(duration)}`}</span>
                </Text>
                <Box style={{ flex: 1 }} />
                {selectionText ? (
                    <Box className="player-strip__segment" data-invalid={hasInvalidSegment || undefined}>
                        <span>{selectionText}</span>
                        <ActionIcon size={18} variant="subtle" color="gray" aria-label="Clear segment" onClick={handleClearRange} disabled={store.operations.isBusy}>
                            <IconX size={14} />
                        </ActionIcon>
                    </Box>
                ) : null}
                <Button
                    variant="default"
                    size="xs"
                    px={8}
                    leftSection={<IconBracketsContainStart size={14} />}
                    onClick={handleMarkStart}
                    disabled={!currentAudioPath || store.operations.isBusy}
                >
                    {'Mark start'}
                </Button>
                <Button
                    variant="default"
                    size="xs"
                    px={8}
                    leftSection={<IconBracketsContainEnd size={14} />}
                    onClick={handleMarkEnd}
                    disabled={!canMarkSegmentEnd}
                >
                    {'Mark end'}
                </Button>
                <Divider orientation="vertical" my={8} />
                {store.operations.kind === 'optimizing-audio' ? (
                    <Group gap={8} wrap="nowrap">
                        <Loader size={14} />
                        <Text size="xs" c="dimmed">{'Optimizing audio…'}</Text>
                    </Group>
                ) : (
                    <SegmentedControl
                        className="player-strip__audio-mode"
                        size="xs"
                        aria-label="Audio version"
                        value={workspace.audioMode}
                        data={AUDIO_MODE_OPTIONS}
                        onChange={(value) => void handleAudioModeChange(value)}
                        disabled={store.operations.isBusy}
                    />
                )}
            </Group>
            <Box className="player-strip__waveform">
                {workspace.isPlayerLoading ? <Loader size="sm" className="player-strip__loader" /> : null}
                <div ref={containerRef} />
            </Box>
        </Box>
    );
});
