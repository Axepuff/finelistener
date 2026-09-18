import { Button, Group, Loader, Modal, RingProgress, Select, Stack, Text } from '@mantine/core';
import { IconCircleCheck, IconCloudDownload } from '@tabler/icons-react';
import type { WhisperModelName } from 'electron/src/types/whisper';
import { observer } from 'mobx-react-lite';
import React, { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../../../../AppContext';

interface Props {
    value: WhisperModelName;
    onChange: (value: WhisperModelName) => void;
    onStatusChange?: (status: { isModelDownloaded: boolean; isDownloadActive: boolean }) => void;
    onDownloadError?: (message: string) => void;
    disabled?: boolean;
    requestDownload?: boolean;
    onDownloadComplete?: () => void;
    onDownloadCancelled?: () => void;
}

export const WhisperModelSelect: React.FC<Props> = observer(({
    value,
    onChange,
    onStatusChange,
    onDownloadError,
    disabled = false,
    requestDownload = false,
    onDownloadComplete,
    onDownloadCancelled,
}) => {
    const store = useAppStore();
    const { whisperModels } = store;
    const [pendingModel, setPendingModel] = useState<WhisperModelName | null>(null);
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);
    const [downloadCancelled, setDownloadCancelled] = useState(false);

    const selectedModelInfo = whisperModels.getModel(value);
    const pendingModelInfo = pendingModel ? whisperModels.getModel(pendingModel) : undefined;
    const isModelDownloaded = selectedModelInfo?.isDownloaded ?? false;
    const isDownloadActive = whisperModels.isDownloadActive;

    useEffect(() => {
        onStatusChange?.({ isModelDownloaded, isDownloadActive });
    }, [isDownloadActive, isModelDownloaded, onStatusChange]);

    useEffect(() => {
        if (requestDownload && !isModelDownloaded && !isConfirmOpen && !downloadCancelled) {
            setPendingModel(value);
            setIsConfirmOpen(true);
        }
    }, [requestDownload, isModelDownloaded, value, isConfirmOpen, downloadCancelled]);

    // Reset cancelled guard when requestDownload is toggled off
    useEffect(() => {
        if (!requestDownload) {
            setDownloadCancelled(false);
        }
    }, [requestDownload]);

    const pendingModelLabel = pendingModel ?? 'selected';
    const confirmText = pendingModelInfo?.sizeLabel
        ? `Download the ${pendingModelLabel} model (${pendingModelInfo.sizeLabel})?`
        : `Download the ${pendingModelLabel} model?`;

    const modelData = useMemo(
        () => whisperModels.models.map((item) => ({
            value: item.name,
            label: item.name,
            disabled: isDownloadActive ? whisperModels.downloadProgress?.name !== item.name : false,
        })),
        [isDownloadActive, whisperModels.downloadProgress?.name, whisperModels.models],
    );

    const handleModelChange = (nextModel: string | null) => {
        if (!nextModel) return;

        const nextModelName = nextModel as WhisperModelName;
        const nextModelInfo = whisperModels.getModel(nextModelName);

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

        onChange(pendingModel);
        setIsConfirmOpen(false);
        const result = await whisperModels.download(pendingModel);

        if (result.ok) {
            onDownloadComplete?.();
        } else {
            onDownloadError?.(result.message);
            onDownloadCancelled?.();
        }
        setPendingModel(null);
    };

    const handleCancelDownload = () => {
        setIsConfirmOpen(false);
        setPendingModel(null);
        setDownloadCancelled(true);
        onDownloadCancelled?.();
    };

    const getModelStatusNode = (modelName: WhisperModelName) => {
        const modelInfo = whisperModels.getModel(modelName);
        const isDownloading = whisperModels.downloadProgress?.name === modelName;
        const progressValue = isDownloading ? whisperModels.downloadProgress?.percent ?? null : null;

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
                    const info = whisperModels.getModel(optionName);

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
});
