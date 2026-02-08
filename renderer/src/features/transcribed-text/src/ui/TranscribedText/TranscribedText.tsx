import { ActionIcon, Box, Button, Group, Notification, Paper, Progress, Stack, Switch, Text } from '@mantine/core';
import { IconCopy } from '@tabler/icons-react';
import { useAtom, useAtomValue } from 'jotai';
import { useCallback, useEffect, useMemo, useRef, useState, type FC, type MouseEvent } from 'react';
import { atoms } from 'renderer/src/atoms';
import { useApp } from '../../../../../AppContext';
import { buildPlainSegments, escapeHtml, formatSecondsReadable, parseTimeToSeconds, resolveTrimOffset } from './utils';

const { appState, transcription } = atoms;

type TranscribedTextProps = {
    onSelectTime: (time: number) => void;
};

const REGION_TEXT_CLASS = 'transcribed-text-content';

export const TranscribedText: FC<TranscribedTextProps> = ({ onSelectTime }) => {
    const { isElectron } = useApp();
    const [plainText, setPlainText] = useAtom(transcription.plainText);
    const [renderedText, setRenderedText] = useAtom(transcription.renderedText);
    const [progress, setProgress] = useState(0);
    const [isCopyNotificationOpen, setIsCopyNotificationOpen] = useState(false);
    const [copyNotificationKey, setCopyNotificationKey] = useState(0);
    const [showRegions, setShowRegions] = useState(true);
    const uiState = useAtomValue(appState.uiState);
    const trimRange = useAtomValue(atoms.transcription.trimRange);
    const trimOffsetRef = useRef<number>(resolveTrimOffset(trimRange));
    const trimOffset = resolveTrimOffset(trimRange);

    const plainSegments = useMemo(() => buildPlainSegments(plainText, trimOffset), [plainText, trimOffset]);
    const plainTextValue = useMemo(
        () => plainSegments.map((segment) => segment.text).join(' '),
        [plainSegments],
    );
    const currentTextValue = showRegions ? plainText : plainTextValue;

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

    const handleSave = async () => {
        if (!currentTextValue) return;
        await window.api!.saveText(currentTextValue);
    };

    const handleCopy = async () => {
        if (!currentTextValue) return;

        try {
            await navigator.clipboard.writeText(currentTextValue);
            setCopyNotificationKey((value) => value + 1);
            setIsCopyNotificationOpen(true);
        } catch (error) {
            console.error('Failed to copy transcribed text', error);
        }
    };

    const handleCopyNotificationClose = () => {
        setIsCopyNotificationOpen(false);
    };

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
        if (!isCopyNotificationOpen) return;

        const timeoutId = window.setTimeout(() => {
            setIsCopyNotificationOpen(false);
        }, 2000);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [copyNotificationKey, isCopyNotificationOpen]);

    useEffect(() => {
        if (uiState === 'transcribing') {
            setProgress(0);
        } else if (uiState === 'initial') {
            setProgress(0);
        }
    }, [uiState]);

    return (
        <Stack gap={16} align="flex-start">
            <style>
                {`
                    .${REGION_TEXT_CLASS} span[data-regions] {
                        cursor: pointer;
                        transition: background-color 0.15s ease, color 0.15s ease;
                    }
                    .${REGION_TEXT_CLASS} span[data-regions]:hover {
                        background-color: rgba(28, 77, 5, 0.12);
                    }
                    .${REGION_TEXT_CLASS} span[data-regions]:active {
                        background-color: rgba(28, 77, 5, 0.2);
                    }
                `}
            </style>
            <Group gap={8} align="center" wrap="wrap">
                <Button
                    disabled={currentTextValue.length === 0}
                    onClick={handleSave}
                >
                    {'Save as .txt'}
                </Button>
                <ActionIcon
                    variant="subtle"
                    disabled={currentTextValue.length === 0}
                    onClick={handleCopy}
                    size={36}
                >
                    <IconCopy size={20} />
                </ActionIcon>
                <Switch
                    checked={showRegions}
                    onChange={() => setShowRegions((prev) => !prev)}
                    label="Show timecodes"
                />
            </Group>

            {uiState === 'transcribing' ? (
                <Group gap={8} align="center" wrap="nowrap" style={{ width: '100%' }}>
                    <Progress value={progress} size={4} style={{ flexGrow: 1 }} />
                    <Text size="sm" style={{ minWidth: 48, textAlign: 'right' }}>
                        {`${progress.toFixed(0)}%`}
                    </Text>
                </Group>
            ) : null}
            <Paper withBorder={true} style={{ padding: 18, overflowY: 'auto', maxHeight: 800, width: '100%' }}>
                {showRegions ? (
                    <Box
                        component="div"
                        className={REGION_TEXT_CLASS}
                        style={{ whiteSpace: 'pre-wrap' }}
                        onClick={handleRegionClick}
                        dangerouslySetInnerHTML={{ __html: renderedText }}
                    />
                ) : (
                    <Box
                        component="div"
                        className={REGION_TEXT_CLASS}
                        style={{ whiteSpace: 'normal' }}
                        onClick={handleRegionClick}
                    >
                        {plainSegments.map((segment, index) => {
                            const regionValue = segment.startSeconds;

                            return (
                                <span key={`${index}-${regionValue ?? 'na'}`} data-regions={regionValue?.toString()}>
                                    {segment.text}
                                    {index < plainSegments.length - 1 ? ' ' : ''}
                                </span>
                            );
                        })}
                    </Box>
                )}
            </Paper>
            {isCopyNotificationOpen ? (
                <Box style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 400 }}>
                    <Notification key={copyNotificationKey} onClose={handleCopyNotificationClose}>
                        {'Text copied'}
                    </Notification>
                </Box>
            ) : null}
        </Stack>
    );
};
