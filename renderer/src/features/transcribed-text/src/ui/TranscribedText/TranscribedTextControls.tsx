import { ActionIcon, Box, Button, Group, Notification, SegmentedControl, Switch, Text, TextInput } from '@mantine/core';
import { IconChevronDown, IconChevronUp, IconClockHour2, IconCopy, IconDownload, IconSearch, IconTextSize, IconUsers, IconX } from '@tabler/icons-react';
import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useAppStore } from 'renderer/src/AppContext';
import styles from './TranscribedText.module.css';
import { transcriptToHtml, type TranscriptView } from 'renderer/src/stores/transcriptFormat';

interface Props {
    currentTextValue: string;
    view: TranscriptView;
    onViewChange: (view: TranscriptView) => void;
    searchQuery: string;
    onSearchChange: (value: string) => void;
    matchCount: number;
    activeMatchIndex: number;
    onPreviousMatch: () => void;
    onNextMatch: () => void;
    speakerControls?: React.ReactNode;
}

export const TranscribedTextControls: React.FC<Props> = observer(({
    currentTextValue,
    view,
    onViewChange,
    searchQuery,
    onSearchChange,
    matchCount,
    activeMatchIndex,
    onPreviousMatch,
    onNextMatch,
    speakerControls,
}) => {
    const store = useAppStore();
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
            await navigator.clipboard.write([new ClipboardItem({
                'text/plain': new Blob([currentTextValue], { type: 'text/plain' }),
                'text/html': new Blob([transcriptToHtml(store.transcription.visibleTranscript, view)], { type: 'text/html' }),
            })]);
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
            <Group className={styles.controlsRow} justify="space-between" align="center" wrap="wrap">
                <Group gap={6} wrap="nowrap" style={{ maxWidth: '100%' }}>
                    <SegmentedControl
                        value={view}
                        onChange={(value) => {
                            if (value === 'plain' || value === 'timecodes' || value === 'speakers') onViewChange(value);
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
                            {
                                value: 'speakers',
                                label: (
                                    <Group gap={6} wrap="nowrap">
                                        <IconUsers size={16} />
                                        <span>{'Speakers'}</span>
                                    </Group>
                                ),
                            },
                        ]}
                    />
                    {speakerControls}
                </Group>

                <Group gap={8} align="center" wrap="wrap" className={styles.actionsGroup}>
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
                        value={searchQuery}
                        onChange={(event) => onSearchChange(event.currentTarget.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                if (event.shiftKey) onPreviousMatch();
                                else onNextMatch();
                            } else if (event.key === 'Escape') {
                                onSearchChange('');
                            }
                        }}
                        placeholder="Search text..."
                        aria-label="Search transcript"
                        leftSection={<IconSearch size={16} />}
                        rightSection={searchQuery ? (
                            <ActionIcon variant="subtle" color="gray" size="sm" aria-label="Clear search" onClick={() => onSearchChange('')}>
                                <IconX size={14} />
                            </ActionIcon>
                        ) : null}
                        className={styles.searchInput}
                    />
                    {searchQuery.trim() ? (
                        <Text size="xs" c="dimmed" className={styles.searchCount} role="status">
                            {matchCount > 0 ? `${activeMatchIndex + 1} of ${matchCount}` : '0 results'}
                        </Text>
                    ) : null}
                    <ActionIcon variant="subtle" color="gray" size={32} aria-label="Previous search result" disabled={matchCount === 0} onClick={onPreviousMatch}>
                        <IconChevronUp size={16} />
                    </ActionIcon>
                    <ActionIcon variant="subtle" color="gray" size={32} aria-label="Next search result" disabled={matchCount === 0} onClick={onNextMatch}>
                        <IconChevronDown size={16} />
                    </ActionIcon>
                    <ActionIcon
                        variant="subtle"
                        color="gray"
                        disabled={currentTextValue.length === 0}
                        onClick={handleCopy}
                        aria-label="Copy transcript"
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
