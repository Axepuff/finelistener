import { ActionIcon, Box, Button, Divider, Group, Loader, SegmentedControl, Text } from '@mantine/core';
import { IconBracketsContainStart, IconBracketsContainEnd, IconPlayerPauseFilled, IconPlayerPlayFilled, IconX } from '@tabler/icons-react';
import { WaveSurferAdapter, type WaveformStatus } from '@~/player/src/ui/Player/WavesurfAdapter';
import { reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from 'renderer/src/AppContext';
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
    const adapterRef = useRef<WaveSurferAdapter | null>(null);
    const [waveformStatus, setWaveformStatus] = useState<WaveformStatus>('loading');
    const { audioSourcePath, activeSession, audioMode, playbackDuration } = workspace;
    const segmentSelection = workspace.segmentSelection;
    const { operationBlockReason } = store;

    useEffect(() => {
        workspace.clearSegment();
        workspace.setPlaybackPosition(0);
        setWaveformStatus('loading');
        const source = store.getPlaybackSource();
        if (!source) return;

        const adapter = new WaveSurferAdapter(containerRef.current!, source, {
            onPlayingChange: (playing) => workspace.setPlaying(playing),
            onDuration: (duration) => workspace.setPlaybackDuration(duration),
            onStatus: setWaveformStatus,
            onTimeUpdate: (time) => workspace.setPlaybackPosition(time),
            onRegionChange: ({ start, end }) => {
                workspace.setSegmentStart(start);
                workspace.setSegmentEnd(end);
            },
        });

        adapterRef.current = adapter;
        const disposeRegionLock = reaction(() => store.operations.isBusy, (locked) => adapter.setRegionEditing(!locked), { fireImmediately: true });

        return () => {
            disposeRegionLock();
            adapter.destroy();
            adapterRef.current = null;
            workspace.setPlaying(false);
            workspace.setPlaybackDuration(0);
        };
    }, [activeSession, audioSourcePath, audioMode, store, workspace]);

    useEffect(() => reaction(
        () => workspace.playbackDuration > 0 ? workspace.playbackRequest : null,
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
        try {
            await adapterRef.current?.playPause();
        } catch (error: unknown) {
            console.error('Failed to play audio', error);
            store.activityLog.appendEvent('Audio could not be played.');
        }
    };

    const handleMarkStart = () => {
        if (store.operations.isBusy) return;
        const safeTime = Math.max(0, adapterRef.current?.currentTime ?? 0);

        adapterRef.current?.setRegion({ start: safeTime });
        workspace.setSegmentStart(safeTime);
    };

    const handleMarkEnd = () => {
        if (store.operations.isBusy) return;
        const safeTime = Math.max(0, adapterRef.current?.currentTime ?? 0);

        adapterRef.current?.setRegion({ end: safeTime });
        workspace.setSegmentEnd(safeTime);
    };

    const handleClearRange = () => {
        if (store.operations.isBusy) return;
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
        playbackDuration > 0
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
                <ActionIcon onClick={onPlayPause} size={32} radius={32} variant="filled" disabled={!playbackDuration} aria-label={workspace.isPlaying ? 'Pause audio' : 'Play audio'}>
                    {workspace.isPlaying ? <IconPlayerPauseFilled size={16} /> : <IconPlayerPlayFilled size={16} />}
                </ActionIcon>
                <Text className="player-strip__time" size="sm" ff="var(--brand-font-family-code)" aria-label={`Current position: ${formatPreciseTime(workspace.playbackPosition)} / ${formatPreciseTime(playbackDuration)}`}>
                    <span style={{ fontWeight: 600 }}>{formatPreciseTime(workspace.playbackPosition)}</span>
                    <span style={{ color: 'var(--brand-color-text-secondary)' }}>{` / ${formatPreciseTime(playbackDuration)}`}</span>
                </Text>
                <Box style={{ flex: 1 }} />
                {selectionText ? (
                    <Box className="player-strip__segment" data-invalid={hasInvalidSegment || undefined}>
                        <span>{selectionText}</span>
                        <ActionIcon size={18} variant="subtle" color="gray" aria-label="Clear segment" onClick={handleClearRange}
                            title={operationBlockReason} aria-description={operationBlockReason} disabled={store.operations.isBusy}>
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
                    title={operationBlockReason}
                    aria-description={operationBlockReason}
                    disabled={!playbackDuration || store.operations.isBusy}
                >
                    {'Mark start'}
                </Button>
                <Button
                    variant="default"
                    size="xs"
                    px={8}
                    leftSection={<IconBracketsContainEnd size={14} />}
                    onClick={handleMarkEnd}
                    title={operationBlockReason}
                    aria-description={operationBlockReason}
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
                        title={operationBlockReason}
                        aria-description={operationBlockReason}
                        value={workspace.audioMode}
                        data={AUDIO_MODE_OPTIONS}
                        onChange={(value) => void handleAudioModeChange(value)}
                        disabled={store.operations.isBusy}
                    />
                )}
            </Group>
            {operationBlockReason && store.operations.kind !== 'optimizing-audio' ? (
                <Text size="xs" c="dimmed" ta="right" px={16}>Segment and audio version locked. {operationBlockReason}</Text>
            ) : null}
            <Box className="player-strip__waveform" aria-busy={Boolean(audioSourcePath && waveformStatus === 'loading')}>
                {audioSourcePath && waveformStatus === 'loading' ? <Loader size="sm" className="player-strip__loader" aria-label="Loading waveform" /> : null}
                {audioSourcePath && (waveformStatus === 'audio-error' || waveformStatus === 'waveform-error') ? (
                    <Text size="xs" c="dimmed" className="player-strip__loader" role="status">{waveformStatus === 'audio-error' ? 'Audio unavailable.' : 'Waveform unavailable.'}</Text>
                ) : null}
                <div ref={containerRef} />
            </Box>
        </Box>
    );
});
