import { Box, Button, Stack, Text, Title } from '@mantine/core';
import { IconFileMusic, IconMicrophone, IconUpload } from '@tabler/icons-react';
import { SystemAudioRecorder } from '@~/recorder';
import { observer } from 'mobx-react-lite';
import React, { useState } from 'react';
import { useAppStore } from 'renderer/src/AppContext';
import { SUPPORTED_MEDIA_EXTENSIONS } from '../../../../../../electron/src/constants';
import styles from './EmptyWorkspace.module.css';

const formats = SUPPORTED_MEDIA_EXTENSIONS.map((extension) => extension.toUpperCase()).join(' · ');

export const EmptyWorkspace: React.FC = observer(() => {
    const store = useAppStore();
    const [isDraggingFile, setIsDraggingFile] = useState(false);
    const [importError, setImportError] = useState('');
    const importDisabled = !store.isElectron || store.operations.isBusy;

    const importAudio = async (file?: File) => {
        setImportError('');

        const result = await store.importAudio(file);
        if (!result.ok) {
            setImportError(result.message);
            store.activityLog.appendEvent(result.message);
        }
    };

    const handleDragOver = (event: React.DragEvent) => {
        const { dataTransfer } = event;
        if (!dataTransfer.types.includes('Files')) return;

        event.preventDefault();
        dataTransfer.dropEffect = importDisabled ? 'none' : 'copy';
        setIsDraggingFile(!importDisabled);
    };

    const handleDragLeave = (event: React.DragEvent) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
            setIsDraggingFile(false);
        }
    };

    const handleDrop = (event: React.DragEvent) => {
        event.preventDefault();
        setIsDraggingFile(false);
        if (importDisabled || !event.dataTransfer.types.includes('Files')) return;

        const files = event.dataTransfer.files;
        const file = files[0];
        const extensionIndex = file?.name.lastIndexOf('.') ?? -1;
        if (!file) {
            setImportError('Could not access the dropped file. Choose an audio file instead.');
        } else if (files.length > 1) {
            setImportError('Drop one audio or video file at a time.');
        } else if (extensionIndex <= 0 || !SUPPORTED_MEDIA_EXTENSIONS.includes(file.name.slice(extensionIndex + 1).toLowerCase())) {
            setImportError('This file format is not supported.');
        } else {
            void importAudio(file);
        }
    };

    return (
        <div className={styles.viewport}>
            <Stack className={styles.content}>
                <Stack gap={8}>
                    <Title order={1} fz={26} lh="34px" fw={600}>{'Record or import audio'}</Title>
                    <Text c="var(--brand-color-text-secondary)" maw={560}>
                        {'FineListener turns speech into text, labels speakers and writes a summary. Runs offline. Audio never leaves this computer.'}
                    </Text>
                </Stack>
                <div className={styles.cards}>
                    <section className={styles.card} aria-label="Record a meeting">
                        <Box className={styles.icon}><IconMicrophone size={20} aria-hidden="true" /></Box>
                        <Stack gap={4}>
                            <Title order={2} fz="lg" lh="26px" fw={600}>{'Record a meeting'}</Title>
                            <Text c="var(--brand-color-text-secondary)">{store.runtimePlatform === 'win32' ?
                                'Capture system audio and your microphone as separate tracks.' :
                                'Capture system audio for transcription.'}</Text>
                        </Stack>
                        <SystemAudioRecorder variant="workspace" />
                    </section>
                    <section
                        className={[styles.card, styles.importCard].join(' ')}
                        aria-label="Import a file"
                        data-dragging={isDraggingFile && !importDisabled || undefined}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                    >
                        <Box className={styles.icon}><IconFileMusic size={20} aria-hidden="true" /></Box>
                        <Stack gap={4}>
                            <Title order={2} fz="lg" lh="26px" fw={600}>{'Import a file'}</Title>
                            <Text c="var(--brand-color-text-secondary)">{'Drop an audio or video file here, or choose one.'}</Text>
                        </Stack>
                        <Text className={styles.formats} size="xs" c="var(--brand-color-text-secondary)">{formats}</Text>
                        {importError ? <Text size="sm" role="alert">{importError}</Text> : null}
                        <Button
                            className={styles.chooseButton}
                            size="lg"
                            fz="sm"
                            fw={400}
                            variant="default"
                            leftSection={<IconUpload size={16} aria-hidden="true" />}
                            disabled={importDisabled}
                            onClick={() => void importAudio()}
                        >
                            {'Choose audio file'}
                        </Button>
                    </section>
                </div>
                <ol className={styles.steps}>
                    <li>{'Record or import audio'}</li>
                    <li>{'Read and search transcripts'}</li>
                    <li>{'Return to saved sessions'}</li>
                </ol>
            </Stack>
        </div>
    );
});
