import { ActionIcon, Box, Button, Group, Notification, SegmentedControl, Switch, TextInput } from '@mantine/core';
import { IconCopy, IconDownload, IconSearch, IconTextSize, IconClockHour2 } from '@tabler/icons-react';
import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useAppStore } from 'renderer/src/AppContext';
import styles from './TranscribedText.module.css';

interface Props {
    currentTextValue: string;
    showRegions: boolean;
    setShowRegions: React.Dispatch<React.SetStateAction<boolean>>;
}

export const TranscribedTextControls: React.FC<Props> = observer(({
    currentTextValue,
    showRegions,
    setShowRegions,
}) => {
    const store = useAppStore();
    const [searchValue, setSearchValue] = useState('');
    const [isCopyNotificationOpen, setIsCopyNotificationOpen] = useState(false);
    const [copyNotificationKey, setCopyNotificationKey] = useState(0);

    const handleSave = async () => {
        if (!currentTextValue) return;

        const result = await store.saveText(currentTextValue);

        if (!result.ok) {
            store.activityLog.appendEvent(result.message);
        }
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

    const handleDuplicateFilterChange = async (enabled: boolean) => {
        const result = await store.setTranscriptDuplicateFilterEnabled(enabled);

        if (!result.ok) store.activityLog.appendEvent(result.message);
    };

    useEffect(() => {
        if (!isCopyNotificationOpen) return;

        const timeoutId = window.setTimeout(() => {
            setIsCopyNotificationOpen(false);
        }, 2000);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [copyNotificationKey, isCopyNotificationOpen]);

    return (
        <>
            <Group className={styles.controlsRow} justify="space-between" align="center" wrap="nowrap">
                <SegmentedControl
                    value={showRegions ? 'timecodes' : 'plain'}
                    onChange={(value) => {
                        setShowRegions(value === 'timecodes');
                    }}
                    className={styles.viewToggle}
                    data={[
                        {
                            value: 'plain',
                            label: (
                                <Group gap={6} wrap="nowrap">
                                    <IconTextSize size={16} />
                                    <span>{'Plain Text'}</span>
                                </Group>
                            ),
                        },
                        {
                            value: 'timecodes',
                            label: (
                                <Group gap={6} wrap="nowrap">
                                    <IconClockHour2 size={16} />
                                    <span>{'Timecodes'}</span>
                                </Group>
                            ),
                        },
                    ]}
                />

                <Group gap={8} align="center" wrap="nowrap" className={styles.actionsGroup}>
                    {store.transcription.duplicateFilterAvailable ? (
                        <Switch
                            checked={store.transcription.duplicateFilterEnabled}
                            disabled={store.operations.isBusy}
                            label="Hide duplicate speech"
                            onChange={(event) => {
                                void handleDuplicateFilterChange(event.currentTarget.checked);
                            }}
                        />
                    ) : null}
                    <TextInput
                        value={searchValue}
                        onChange={(event) => setSearchValue(event.currentTarget.value)}
                        placeholder="Search text..."
                        leftSection={<IconSearch size={16} />}
                        className={styles.searchInput}
                    />
                    <ActionIcon
                        variant="subtle"
                        color="gray"
                        disabled={currentTextValue.length === 0}
                        onClick={handleCopy}
                        size={36}
                    >
                        <IconCopy size={18} />
                    </ActionIcon>
                    <Button
                        disabled={currentTextValue.length === 0}
                        onClick={handleSave}
                        leftSection={<IconDownload size={14} />}
                        className={styles.saveButton}
                    >
                        {'Save .txt'}
                    </Button>
                </Group>
            </Group>

            {isCopyNotificationOpen ? (
                <Box className={styles.copyNotificationWrapper}>
                    <Notification key={copyNotificationKey} onClose={handleCopyNotificationClose}>
                        {'Text copied'}
                    </Notification>
                </Box>
            ) : null}
        </>
    );
});
