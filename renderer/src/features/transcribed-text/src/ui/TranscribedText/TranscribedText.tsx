import { Button, LinearProgress } from '@mui/material';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useState, type FC, type MouseEvent } from 'react';
import { atoms } from 'renderer/src/atoms';
import { useApp } from '../../../../../AppContext';

const { appState } = atoms;

type TranscribedTextProps = {
    onSelectTime: (time: number) => void;
};

export const TranscribedText: FC<TranscribedTextProps> = ({ onSelectTime }) => {
    const { isElectron } = useApp();
    const [plainText, setPlainText] = useState('');
    const [renderedText, setRenderedText] = useState('');
    const [progress, setProgress] = useState(0);
    const uiState = useAtomValue(appState.uiState);

    const escapeHtml = (value: string) =>
        value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

    const enhanceChunk = (chunk: string) => {
        const placeholders: Array<{ placeholder: string; markup: string }> = [];

        const withPlaceholders = chunk.replace(/\[([^\]]+)\]/g, (match, content: string) => {
            const [firstRegion = ''] = content.split('-->');
            const placeholder = `__REGION_PLACEHOLDER_${placeholders.length}__`;

            placeholders.push({
                placeholder,
                markup: `<span data-regions="${escapeHtml(firstRegion.trim())}">${escapeHtml(match)}</span>`,
            });

            return placeholder;
        });

        const escaped = escapeHtml(withPlaceholders);

        return placeholders.reduce((acc, { placeholder, markup }) => acc.split(placeholder).join(markup), escaped);
    };

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

    const handleTranscribeProgress = (chunk: string) => {
        setPlainText((t) => t + chunk);
        setRenderedText((t) => t + enhanceChunk(chunk));
    };

    const handleSave = async () => {
        if (!plainText) return;
        await window.api!.saveText(plainText);
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
        const off1 = window.api!.onTranscribeProgress(handleTranscribeProgress);
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
        <Stack gap="16px">
            <Button
                disabled={plainText.length === 0}
                variant="contained"
                onClick={handleSave}
            >
                {'Сохранить в .txt'}
            </Button>
            {uiState === 'transcribing' ? (
                <Stack direction="row" spacing={1} alignItems="center">
                    <LinearProgress variant="determinate" value={progress} sx={{ flexGrow: 1 }} />
                    <Typography variant="body2" sx={{ minWidth: 48, textAlign: 'right' }}>
                        {`${progress.toFixed(0)}%`}
                    </Typography>
                </Stack>
            ) : null}
            <Paper variant="outlined" sx={{ p: 3, overflowY: 'auto', maxHeight: 800 }}>
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
        </Stack>
    );
};
