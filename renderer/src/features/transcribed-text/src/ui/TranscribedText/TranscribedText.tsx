import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { Button, IconButton, LinearProgress } from '@mui/material';
import Paper from '@mui/material/Paper';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useAtom, useAtomValue } from 'jotai';
import { useCallback, useEffect, useRef, useState, type FC, type MouseEvent, type SyntheticEvent } from 'react';
import { atoms, type TrimRange } from 'renderer/src/atoms';
import { useApp } from '../../../../../AppContext';

const { appState, transcription } = atoms;

type TranscribedTextProps = {
    onSelectTime: (time: number) => void;
};

const resolveTrimOffset = (range?: TrimRange) => {
    const start = range?.start;

    return typeof start === 'number' && Number.isFinite(start) ? start : 0;
};

const formatSecondsReadable = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '';

    const totalMs = Math.round(seconds * 1000);
    const hours = Math.floor(totalMs / 3_600_000);
    const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
    const secs = Math.floor((totalMs % 60_000) / 1000);
    const ms = totalMs % 1000;

    const hh = String(hours).padStart(2, '0');
    const mm = String(minutes).padStart(2, '0');
    const ss = String(secs).padStart(2, '0');
    const mmm = String(ms).padStart(3, '0');

    return `${hh}:${mm}:${ss}.${mmm}`;
};

const escapeHtml = (value: string) =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const parseTimeToSeconds = (value: string): number | null => {
    const sanitized = value.trim().replace(',', '.');

    if (!sanitized) return null;

    const parts = sanitized.split(':').map((part) => part.trim());

    if (parts.some((part) => part === '')) return null;

    let totalSeconds = 0;

    for (const part of parts) {
        const numeric = Number(part);

        if (Number.isNaN(numeric)) return null;

        totalSeconds = totalSeconds * 60 + numeric;
    }

    return totalSeconds;
};

export const TranscribedText: FC<TranscribedTextProps> = ({ onSelectTime }) => {
    const { isElectron } = useApp();
    const [plainText, setPlainText] = useAtom(transcription.plainText);
    const [renderedText, setRenderedText] = useAtom(transcription.renderedText);
    const [progress, setProgress] = useState(0);
    const [isCopySnackbarOpen, setIsCopySnackbarOpen] = useState(false);
    const [copySnackbarKey, setCopySnackbarKey] = useState(0);
    const uiState = useAtomValue(appState.uiState);
    const trimRange = useAtomValue(atoms.transcription.trimRange);
    const trimOffsetRef = useRef<number>(resolveTrimOffset(trimRange));

    useEffect(() => {
        trimOffsetRef.current = resolveTrimOffset(trimRange);
    }, [trimRange]);

    const formatRegionValue = (rawRegion: string) => {
        const parsedSeconds = parseTimeToSeconds(rawRegion);

        if (parsedSeconds === null) return rawRegion.trim();

        const adjustedSeconds = parsedSeconds + trimOffsetRef.current;

        if (!Number.isFinite(adjustedSeconds)) return rawRegion.trim();

        return Number(adjustedSeconds.toFixed(3)).toString();
    };

    const formatRegionLabel = (rawContent: string, fallback: string) => {
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
    };

    const enhanceChunk = (chunk: string) => {
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
    };

    const handleTranscribeProgress = (chunk: string) => {
        console.log(chunk);

        setPlainText((t) => t + chunk);
        setRenderedText((t) => t + enhanceChunk(chunk));
    };

    const handleSave = async () => {
        if (!plainText) return;
        await window.api!.saveText(plainText);
    };

    const handleCopy = async () => {
        if (!plainText) return;

        try {
            await navigator.clipboard.writeText(plainText);
            setCopySnackbarKey((value) => value + 1);
            setIsCopySnackbarOpen(true);
        } catch (error) {
            console.error('Failed to copy transcribed text', error);
        }
    };

    const handleCopySnackbarClose = (_event?: SyntheticEvent | Event, reason?: string) => {
        if (reason === 'clickaway') return;

        setIsCopySnackbarOpen(false);
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
        const off1 = window.api!.onTranscribeText(handleTranscribeProgress);
        const off2 = window.api!.onTranscribeProgressValue((value) => {
            const next = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;

            setProgress(next);
        });

        return () => {
            off1?.();
            off2?.();
        };
    }, [isElectron]);

    useEffect(() => {
        if (uiState === 'transcribing') {
            setProgress(0);
        } else if (uiState === 'initial') {
            setProgress(0);
        }
    }, [uiState]);

    return (
        <Stack gap="16px" alignItems="flex-start">
            <Stack direction="row" gap={2}>
                <Button
                    size="large"
                    fullWidth={false}
                    disabled={plainText.length === 0}
                    variant="contained"
                    onClick={handleSave}
                >
                    {'Сохранить в .txt'}
                </Button>
                <IconButton
                    disabled={plainText.length === 0}
                    onClick={handleCopy}
                >
                    <ContentCopyIcon />
                </IconButton>
            </Stack>

            {uiState === 'transcribing' ? (
                <Stack direction="row" spacing={1} alignItems="center" width="100%">
                    <LinearProgress variant="determinate" value={progress} sx={{ flexGrow: 1 }} />
                    <Typography variant="body2" sx={{ minWidth: 48, textAlign: 'right' }}>
                        {`${progress.toFixed(0)}%`}
                    </Typography>
                </Stack>
            ) : null}
            <Paper variant="outlined" sx={{ p: 3, overflowY: 'auto', maxHeight: 800, width: '100%' }}>
                <Typography
                    component="div"
                    variant="body1"
                    sx={{
                        whiteSpace: 'pre-wrap',
                        '& span[data-regions]': {
                            cursor: 'pointer',
                            transition: 'background-color 0.15s ease, color 0.15s ease',
                        },
                        '& span[data-regions]:hover': {
                            backgroundColor: 'rgba(28, 77, 5, 0.12)',
                        },
                        '& span[data-regions]:active': {
                            backgroundColor: 'rgba(28, 77, 5, 0.2)',
                        },
                    }}
                    onClick={handleRegionClick}
                    dangerouslySetInnerHTML={{ __html: renderedText }}
                />
            </Paper>
            <Snackbar
                key={copySnackbarKey}
                anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
                message="Текст скопирован"
                open={isCopySnackbarOpen}
                autoHideDuration={2000}
                onClose={handleCopySnackbarClose}
            />
        </Stack>
    );
};
