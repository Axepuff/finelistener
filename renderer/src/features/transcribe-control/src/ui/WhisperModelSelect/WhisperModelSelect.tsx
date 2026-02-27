import { Button, Group, Loader, Modal, RingProgress, Select, Stack, Text } from '@mantine/core';
import { IconCircleCheck, IconCloudDownload } from '@tabler/icons-react';
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

    const modelData = useMemo(
        () => modelOptions.map((item) => ({
            value: item.name,
            label: item.name,
            disabled: isDownloadActive ? downloadProgress?.name !== item.name : false,
        })),
        [downloadProgress?.name, isDownloadActive, modelOptions],
    );

    const handleModelChange = (nextModel: string | null) => {
        if (!nextModel) return;

        const nextModelName = nextModel as WhisperModelName;
        const nextModelInfo = modelOptions.find((item) => item.name === nextModelName);

        if (!nextModelInfo || nextModelInfo.isDownloaded) {
            onChange(nextModelName);

            return;
        }

        setPendingModel(nextModelName);
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

    const getModelStatusNode = (modelName: WhisperModelName) => {
        const modelInfo = modelOptions.find((item) => item.name === modelName);
        const isDownloading = downloadProgress?.name === modelName;
        const progressValue = isDownloading ? downloadProgress?.percent ?? null : null;

        if (isDownloading) {
            if (progressValue === null) {
                return <Loader size={14} />;
            }

            return (
                <RingProgress
                    size={14}
                    thickness={2}
                    sections={[{ value: progressValue, color: 'gray' }]}
                />
            );
        }

        if (modelInfo?.isDownloaded) {
            return <IconCircleCheck color="var(--mantine-color-green-6)" size={14} />;
        }

        return <IconCloudDownload color="var(--mantine-color-gray-6)" size={14} />;
    };

    return (
        <>
            <Select
                label="Model"
                value={value}
                onChange={handleModelChange}
                data={modelData}
                rightSection={getModelStatusNode(value)}
                disabled={disabled || isDownloadActive}
                renderOption={({ option }) => {
                    const optionName = option.value as WhisperModelName;
                    const info = modelOptions.find((item) => item.name === optionName);

                    return (
                        <Group gap={8} justify="space-between" wrap="nowrap">
                            <Stack gap={0} style={{ flexGrow: 1 }}>
                                <Text size="sm" style={{ textTransform: 'lowercase' }}>
                                    {optionName}
                                </Text>
                                {info?.sizeLabel ? (
                                    <Text size="xs" c="dimmed">
                                        {info.sizeLabel}
                                    </Text>
                                ) : null}
                            </Stack>
                            {getModelStatusNode(optionName)}
                        </Group>
                    );
                }}
            />
            <Modal opened={isConfirmOpen} onClose={handleCancelDownload} title="Download model" centered={true}>
                <Stack gap={12}>
                    <Text size="sm">{confirmText}</Text>
                    <Group justify="flex-end" gap={8}>
                        <Button variant="outline" onClick={handleCancelDownload}>{'Cancel'}</Button>
                        <Button onClick={handleConfirmDownload}>
                            {'Download'}
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </>
    );
};
