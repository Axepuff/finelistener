import { Button, LinearProgress } from '@mui/material';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useState, type FC } from 'react';
import { useApp } from '../../../../../AppContext';
import { useAtomValue } from 'jotai';
import { atoms } from 'renderer/src/atoms';

const { appState } = atoms;

type TranscribedTextProps = {
    onSelectTime: (time: number) => void;
};

export const TranscribedText: FC<TranscribedTextProps> = () => {
    const { isElectron } = useApp();
    const [text, setText] = useState('');
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
                markup: `<span data-regions="${escapeHtml(firstRegion.trim())}">${escapeHtml(match)}</span>`
            });

            return placeholder;
        });

        const escaped = escapeHtml(withPlaceholders);

        return placeholders.reduce((acc, { placeholder, markup }) => acc.split(placeholder).join(markup), escaped);
    };

    const handleTranscribeProgress = (chunk: string) => {
        setText((t) => t + enhanceChunk(chunk));
    };

    const handleSave = async () => {
        if (!text) return;
        await window.api!.saveText(text);
    };

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
                disabled={text.length === 0}
                variant="contained"
                onClick={handleSave}
            >
                {'Сохранить .txt'}
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
                    sx={{ whiteSpace: 'pre-wrap' }}
                    dangerouslySetInnerHTML={{ __html: text }}
                />
            </Paper>
        </Stack>
    );
};
