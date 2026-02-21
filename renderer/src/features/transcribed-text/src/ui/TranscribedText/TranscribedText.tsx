import { ActionIcon, Group, Paper, Progress, Stack, Text } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { useAtom, useAtomValue } from 'jotai';
import React, { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { atoms } from 'renderer/src/atoms';
import { useApp } from '../../../../../AppContext';
import { TranscribedTextContent } from './TranscribedTextContent';
import { TranscribedTextControls } from './TranscribedTextControls';
import { buildPlainSegments, escapeHtml, formatSecondsReadable, parseTimeToSeconds, resolveTrimOffset } from './utils';

const { appState, transcription } = atoms;

type TranscribedTextProps = {
    onSelectTime: (time: number) => void;
};

export const TranscribedText: React.FC<TranscribedTextProps> = ({ onSelectTime }) => {
    const { isElectron } = useApp();
    const [plainText, setPlainText] = useAtom(transcription.plainText);
    const [renderedText, setRenderedText] = useAtom(transcription.renderedText);
    const [progress, setProgress] = useState(0);
    const [showRegions, setShowRegions] = useState(true);
    const uiState = useAtomValue(appState.uiState);
    const trimRange = useAtomValue(atoms.transcription.trimRange);
    const trimOffsetRef = useRef<number>(resolveTrimOffset(trimRange));
    const trimOffset = resolveTrimOffset(trimRange);
    const [, setAudioToTranscribe] = useAtom(atoms.transcription.audioToTranscribe);
    const [, setRunOutcome] = useAtom(atoms.transcription.runOutcome);
    const [, setRunErrorMessage] = useAtom(atoms.transcription.runErrorMessage);

    const plainSegments = useMemo(() => buildPlainSegments(plainText, trimOffset), [plainText, trimOffset]);
    const plainTextValue = useMemo(
        () => plainSegments.map((segment) => segment.text).join(' '),
        [plainSegments],
    );
    const currentTextValue = showRegions ? plainText : plainTextValue;
    const isInitialEmptyState = uiState === 'initial' && currentTextValue.trim().length === 0;

    useEffect(() => {
        trimOffsetRef.current = resolveTrimOffset(trimRange);
    }, [trimRange]);

    const formatRegionValue = useCallback((rawRegion: string) => {
        const parsedSeconds = parseTimeToSeconds(rawRegion);

        if (parsedSeconds === null) return rawRegion.trim();

        const adjustedSeconds = parsedSeconds + trimOffsetRef.current;

        if (!Number.isFinite(adjustedSeconds)) return rawRegion.trim();

        return Number(adjustedSeconds.toFixed(3)).toString();
    }, []);

    const formatRegionLabel = useCallback((rawContent: string, fallback: string) => {
        const [rawStart = '', rawEnd] = rawContent.split('-->');
        const parsedStart = parseTimeToSeconds(rawStart);
        const adjustedStart = parsedStart === null ? null : parsedStart + trimOffsetRef.current;
        const startValue = adjustedStart !== null ? formatSecondsReadable(adjustedStart) : '';
        const safeStart = startValue || rawStart.trim();

        if (rawEnd === undefined) {
            return safeStart ? `[${safeStart}]` : fallback;
        }

        const parsedEnd = parseTimeToSeconds(rawEnd);
        const adjustedEnd = parsedEnd === null ? null : parsedEnd + trimOffsetRef.current;
        const endValue = adjustedEnd !== null ? formatSecondsReadable(adjustedEnd) : '';
        const safeEnd = endValue || rawEnd.trim();

        if (!safeStart && !safeEnd) return fallback;

        return `[${safeStart} --> ${safeEnd}]`;
    }, []);

    const enhanceChunk = useCallback((chunk: string) => {
        const placeholders: Array<{ placeholder: string; markup: string }> = [];

        const withPlaceholders = chunk.replace(/\[([^\]]+)\]/g, (match, content: string) => {
            const [firstRegion = ''] = content.split('-->');
            const placeholder = `__REGION_PLACEHOLDER_${placeholders.length}__`;
            const regionValue = formatRegionValue(firstRegion);
            const label = formatRegionLabel(content, match);

            placeholders.push({
                placeholder,
                markup: `<span data-regions="${escapeHtml(regionValue)}">${escapeHtml(label)}</span>`,
            });

            return placeholder;
        });

        const escaped = escapeHtml(withPlaceholders);

        return placeholders.reduce((acc, { placeholder, markup }) => acc.split(placeholder).join(markup), escaped);
    }, [formatRegionLabel, formatRegionValue]);

    const handleRegionClick = useCallback(
        (event: MouseEvent<HTMLElement>) => {
            const regionElement = (event.target as HTMLElement | null)?.closest('span[data-regions]');

            if (!regionElement) return;

            const region = regionElement.getAttribute('data-regions');
            const time = region ? parseTimeToSeconds(region) : null;

            if (time === null) return;

            onSelectTime(time);
        },
        [onSelectTime],
    );

    const handlePick = async () => {
        if (!isElectron) return;
        const file = await window.api!.pickAudio();

        if (!file) {
            return;
        }

        try {
            const { path } = await window.api!.convertAudio({ audioPath: file, lowPass: 12000, highPass: 80 });

            setAudioToTranscribe([path]);
            setRunOutcome('none');
            setRunErrorMessage(null);
        } catch (error) {
            console.error('Failed to convert audio', error);
        }
    };

    useEffect(() => {
        if (!isElectron) return;

        const off1 = window.api!.onTranscribeText((chunk) => {
            console.log(chunk);
            setPlainText((text) => text + chunk);
            setRenderedText((text) => text + enhanceChunk(chunk));
        });

        const off2 = window.api!.onTranscribeProgressValue((value) => {
            const next = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;

            setProgress(next);
        });

        return () => {
            off1?.();
            off2?.();
        };
    }, [enhanceChunk, isElectron, setPlainText, setRenderedText]);

    useEffect(() => {
        if (uiState === 'transcribing') {
            setProgress(0);
        } else if (uiState === 'initial') {
            setProgress(0);
        }
    }, [uiState]);

    return (
        <Stack gap={16} align="stretch" style={{ width: '100%', minHeight: 0, height: '100%', padding: 16 }}>
            {isInitialEmptyState ? (
                <Paper
                    style={{
                        width: '100%',
                        minHeight: 0,
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <Stack gap={12} align="center" style={{ maxWidth: 280 }}>
                        <ActionIcon
                            size={64}
                            variant="light"
                            onClick={handlePick}
                        >
                            <IconPlus size={30} color="var(--mantine-color-gray-5)" />
                        </ActionIcon>

                        <Text size="md" fw={600} c="gray.6" ta="center">
                            {'No transcription available yet'}
                        </Text>
                        <Text size="sm" c="gray.5" ta="center">
                            {'Upload a file and click "Transcribe" to see the result here.'}
                        </Text>
                    </Stack>
                </Paper>
            ) : (
                <>
                    <TranscribedTextControls
                        currentTextValue={currentTextValue}
                        showRegions={showRegions}
                        setShowRegions={setShowRegions}
                    />

                    {uiState === 'transcribing' ? (
                        <Group gap={8} align="center" wrap="nowrap" style={{ width: '100%' }}>
                            <Progress value={progress} size={4} style={{ flexGrow: 1 }} />
                            <Text size="sm" style={{ minWidth: 48, textAlign: 'right' }}>
                                {`${progress.toFixed(0)}%`}
                            </Text>
                        </Group>
                    ) : null}

                    <TranscribedTextContent
                        showRegions={showRegions}
                        renderedText={renderedText}
                        plainSegments={plainSegments}
                        onRegionClick={handleRegionClick}
                    />
                </>
            )}
        </Stack>
    );
};
