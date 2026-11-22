import { ActionIcon, Box, Button, Group, Notification, SegmentedControl, Switch } from '@mantine/core';
import { IconChevronDown, IconChevronUp, IconCopy, IconDownload, IconSearch, IconX } from '@tabler/icons-react';
import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useAppStore } from 'renderer/src/AppContext';
import styles from './TranscribedText.module.css';
import type { TranscriptView } from 'renderer/src/stores/transcriptFormat';

interface Props {
    currentTextValue: string;
    getClipboardHtml: () => string;
    view: TranscriptView | 'summary';
    onViewChange: (view: TranscriptView | 'summary') => void;
    searchQuery: string;
    onSearchChange: (value: string) => void;
    matchCount: number;
    activeMatchIndex: number;
    onPreviousMatch: () => void;
    onNextMatch: () => void;
}

export const TranscribedTextControls: React.FC<Props> = observer(({
    currentTextValue,
    getClipboardHtml,
    view,
    onViewChange,
    searchQuery,
    onSearchChange,
    matchCount,
    activeMatchIndex,
    onPreviousMatch,
    onNextMatch,
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
                'text/html': new Blob([getClipboardHtml()], { type: 'text/html' }),
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
            <div className={styles.controlsRow}>
                <SegmentedControl
                    aria-label="Transcript view"
                    value={view}
                    onChange={(value) => {
                        if (value === 'plain' || value === 'timecodes' || value === 'speakers' || value === 'summary') onViewChange(value);
                    }}
                    classNames={{ root: styles.viewToggle, label: styles.toggleLabel }}
                    data={[
                        { value: 'plain', label: 'Text' },
                        { value: 'timecodes', label: 'Timecodes' },
                        { value: 'speakers', label: 'Speakers' },
                        { value: 'summary', label: 'Summary' },
                    ]}
                />

                {view !== 'summary' && (
                    <Group gap={8} align="center" wrap="nowrap" className={styles.actionsGroup}>
                        <div className={styles.searchField} role="search" aria-label="Transcript">
                            <IconSearch size={16} aria-hidden="true" />
                            <input
                                value={searchQuery}
                                onChange={(event) => onSearchChange(event.currentTarget.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        event.preventDefault();
                                        if (event.shiftKey) onPreviousMatch();
                                        else onNextMatch();
                                    } else if (event.key === 'Escape' && searchQuery) {
                                        event.stopPropagation();
                                        onSearchChange('');
                                    }
                                }}
                                placeholder="Search transcript"
                                aria-label="Search transcript"
                                className={styles.searchInput}
                            />
                            {searchQuery.trim() ? (
                                <span className={styles.searchCount} role="status">
                                    {matchCount > 0 ? `${activeMatchIndex + 1} of ${matchCount}` : '0 results'}
                                </span>
                            ) : null}
                            {searchQuery ? (
                                <>
                                    <ActionIcon variant="subtle" color="gray" size={24} aria-label="Previous search result" disabled={matchCount === 0} onClick={onPreviousMatch}>
                                        <IconChevronUp size={16} />
                                    </ActionIcon>
                                    <ActionIcon variant="subtle" color="gray" size={24} aria-label="Next search result" disabled={matchCount === 0} onClick={onNextMatch}>
                                        <IconChevronDown size={16} />
                                    </ActionIcon>
                                    <ActionIcon variant="subtle" color="gray" size={24} aria-label="Clear search" onClick={() => onSearchChange('')}>
                                        <IconX size={14} />
                                    </ActionIcon>
                                </>
                            ) : null}
                        </div>
                        <ActionIcon
                            variant="default"
                            disabled={currentTextValue.length === 0}
                            onClick={handleCopy}
                            aria-label="Copy transcript"
                            title="Copy transcript"
                            size={32}
                        >
                            <IconCopy size={16} />
                        </ActionIcon>
                        <Button
                            size="sm"
                            variant="default"
                            disabled={currentTextValue.length === 0}
                            onClick={handleSave}
                            leftSection={<IconDownload size={16} />}
                            className={styles.exportButton}
                        >
                            Export
                        </Button>
                    </Group>
                )}
            </div>
            {view !== 'summary' && store.transcription.duplicateFilterAvailable ? (
                <Switch
                    checked={store.transcription.duplicateFilterEnabled}
                    disabled={store.operations.isBusy}
                    label="Hide duplicate speech"
                    className={styles.duplicateFilter}
                    onChange={(event) => {
                        void handleDuplicateFilterChange(event.currentTarget.checked);
                    }}
                />
            ) : null}

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
