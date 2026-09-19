import { Button, Group, Loader, Modal, RingProgress, Select, Stack, Text } from '@mantine/core';
import { IconCircleCheck, IconCloudDownload } from '@tabler/icons-react';
import type { WhisperModelName } from 'electron/src/types/whisper';
import { observer } from 'mobx-react-lite';
import React, { useMemo, useState } from 'react';
import { useAppStore } from '../../../../../AppContext';

interface Props {
    value: WhisperModelName;
    onChange: (value: WhisperModelName) => void;
    onDownloadError?: (message: string) => void;
    disabled?: boolean;
}

export const WhisperModelSelect: React.FC<Props> = observer(({
    value,
    onChange,
    onDownloadError,
    disabled = false,
}) => {
    const store = useAppStore();
    const { whisperModels } = store;
    const [pendingModel, setPendingModel] = useState<WhisperModelName | null>(null);
    const control = store.transcriptionControl;
    const requestedModel = control.isDownloadingPendingModel ? null : control.pendingDownloadModel;
    const confirmationModel = requestedModel ?? pendingModel;
    const isConfirmOpen = confirmationModel !== null;
    const pendingModelInfo = confirmationModel ? whisperModels.getModel(confirmationModel) : undefined;
    const isDownloadActive = whisperModels.isDownloadActive;

    const pendingModelLabel = confirmationModel ?? 'selected';
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
    };

    const handleConfirmDownload = async () => {
        if (!confirmationModel || isDownloadActive) return;

        const modelToDownload = confirmationModel;
        setPendingModel(null);
        const result = requestedModel
            ? await store.confirmPendingTranscriptionDownload()
            : await downloadSelectedModel(modelToDownload);

        if (!result.ok) onDownloadError?.(result.message);
    };

    const downloadSelectedModel = async (modelName: WhisperModelName) => {
        onChange(modelName);
        return store.downloadWhisperModel(modelName);
    };

    const handleCancelDownload = () => {
        setPendingModel(null);
        control.cancelPendingDownload();
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
                        <Button onClick={handleConfirmDownload} disabled={isDownloadActive}>
                            {'Download'}
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </>
    );
});
