import { CheckCircle, CloudDownload } from '@mui/icons-material';
import {
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    FormControl,
    InputLabel,
    MenuItem,
    Select,
    type SelectChangeEvent,
    Stack,
    Typography,
} from '@mui/material';
import type { WhisperModelDownloadProgress, WhisperModelInfo, WhisperModelName } from 'electron/src/types/whisper';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../../../../AppContext';

interface Props {
    value: WhisperModelName;
    onChange: (value: WhisperModelName) => void;
    onStatusChange?: (status: { isModelDownloaded: boolean; isDownloadActive: boolean }) => void;
    onDownloadError?: (message: string) => void;
    disabled?: boolean;
}

export const WhisperModelSelect: React.FC<Props> = ({
    value,
    onChange,
    onStatusChange,
    onDownloadError,
    disabled = false,
}) => {
    const { isElectron } = useApp();
    const [modelOptions, setModelOptions] = useState<WhisperModelInfo[]>([]);
    const [pendingModel, setPendingModel] = useState<WhisperModelName | null>(null);
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState<WhisperModelDownloadProgress | null>(null);

    const loadWhisperModels = useCallback(async () => {
        if (!window.api?.getWhisperModels) return;

        try {
            const models = await window.api.getWhisperModels();

            setModelOptions(models);
        } catch (error) {
            console.error('Failed to load whisper models', error);
        }
    }, []);

    useEffect(() => {
        if (!isElectron) return;

        void loadWhisperModels();
    }, [isElectron, loadWhisperModels]);

    useEffect(() => {
        if (!window.api?.onWhisperModelDownloadProgress) return;

        const off = window.api.onWhisperModelDownloadProgress((progress) => {
            setDownloadProgress(progress);
        });

        return () => {
            off?.();
        };
    }, []);

    const selectedModelInfo = useMemo(
        () => modelOptions.find((item) => item.name === value),
        [modelOptions, value],
    );
    const pendingModelInfo = useMemo(
        () => modelOptions.find((item) => item.name === pendingModel),
        [modelOptions, pendingModel],
    );
    const isModelDownloaded = selectedModelInfo?.isDownloaded ?? false;
    const isDownloadActive = Boolean(downloadProgress);

    useEffect(() => {
        onStatusChange?.({ isModelDownloaded, isDownloadActive });
    }, [isDownloadActive, isModelDownloaded, onStatusChange]);

    const pendingModelLabel = pendingModel ?? 'selected';
    const confirmText = pendingModelInfo?.sizeLabel
        ? `Download the ${pendingModelLabel} model (${pendingModelInfo.sizeLabel})?`
        : `Download the ${pendingModelLabel} model?`;

    const handleModelChange = (event: SelectChangeEvent<WhisperModelName>) => {
        const nextModel = event.target.value;
        const nextModelInfo = modelOptions.find((item) => item.name === nextModel);

        if (!nextModelInfo || nextModelInfo.isDownloaded) {
            onChange(nextModel);

            return;
        }

        setPendingModel(nextModel);
        setIsConfirmOpen(true);
    };

    const handleConfirmDownload = async () => {
        if (!pendingModel) {
            setIsConfirmOpen(false);

            return;
        }

        if (!window.api?.downloadWhisperModel) {
            setIsConfirmOpen(false);
            setPendingModel(null);

            return;
        }

        onChange(pendingModel);
        setIsConfirmOpen(false);
        setDownloadProgress({
            name: pendingModel,
            percent: 0,
            downloadedBytes: 0,
            totalBytes: null,
        });

        try {
            await window.api.downloadWhisperModel(pendingModel);
            await loadWhisperModels();
        } catch (error) {
            console.error('Failed to download whisper model', error);
            onDownloadError?.('Failed to download the model. Please try again.');
        } finally {
            setDownloadProgress(null);
            setPendingModel(null);
        }
    };

    const handleCancelDownload = () => {
        setIsConfirmOpen(false);
        setPendingModel(null);
    };

    const renderModelValue = useCallback(
        (selected: WhisperModelName) => {
            const current = modelOptions.find((item) => item.name === selected);
            const isDownloading = downloadProgress?.name === selected;
            const progressValue = isDownloading ? downloadProgress?.percent ?? null : null;

            return (
                <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="body2" sx={{ textTransform: 'lowercase' }}>
                        {selected}
                    </Typography>
                    {current?.sizeLabel ? (
                        <Typography variant="caption" color="text.secondary">
                            {current.sizeLabel}
                        </Typography>
                    ) : null}
                    {isDownloading ? (
                        <CircularProgress
                            size={14}
                            variant={progressValue === null ? 'indeterminate' : 'determinate'}
                            value={progressValue === null ? undefined : progressValue}
                        />
                    ) : current?.isDownloaded ? (
                        <CheckCircle color="success" fontSize="small" />
                    ) : (
                        <CloudDownload color="action" fontSize="small" />
                    )}
                </Stack>
            );
        },
        [downloadProgress, modelOptions],
    );

    return (
        <>
            <FormControl size="small">
                <InputLabel id="transcribe-model-label">{'Модель'}</InputLabel>
                <Select
                    labelId="transcribe-model-label"
                    label="Модель"
                    value={value}
                    onChange={handleModelChange}
                    renderValue={renderModelValue}
                    disabled={disabled || isDownloadActive}
                >
                    {modelOptions.map((item) => {
                        const isDownloading = downloadProgress?.name === item.name;
                        const progressValue = isDownloading ? downloadProgress?.percent ?? null : null;

                        return (
                            <MenuItem
                                key={item.name}
                                value={item.name}
                                disabled={isDownloadActive ? !isDownloading : false}
                            >
                                <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
                                    <Stack spacing={0} sx={{ flexGrow: 1 }}>
                                        <Typography variant="body2" sx={{ textTransform: 'lowercase' }}>
                                            {item.name}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {item.sizeLabel}
                                        </Typography>
                                    </Stack>
                                    {isDownloading ? (
                                        <CircularProgress
                                            size={14}
                                            variant={progressValue === null ? 'indeterminate' : 'determinate'}
                                            value={progressValue === null ? undefined : progressValue}
                                        />
                                    ) : item.isDownloaded ? (
                                        <CheckCircle color="success" fontSize="small" />
                                    ) : (
                                        <CloudDownload color="action" fontSize="small" />
                                    )}
                                </Stack>
                            </MenuItem>
                        );
                    })}
                </Select>
            </FormControl>
            <Dialog open={isConfirmOpen} onClose={handleCancelDownload}>
                <DialogTitle>{'Download model'}</DialogTitle>
                <DialogContent>
                    <DialogContentText>{confirmText}</DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCancelDownload}>{'Cancel'}</Button>
                    <Button variant="contained" onClick={handleConfirmDownload}>
                        {'Download'}
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
};
