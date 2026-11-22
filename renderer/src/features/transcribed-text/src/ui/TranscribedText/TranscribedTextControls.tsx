import { ActionIcon, Box, Button, Group, Notification, SegmentedControl, Switch, Text } from '@mantine/core';
import { IconChevronDown, IconChevronUp, IconCopy, IconDownload, IconSearch, IconX } from '@tabler/icons-react';
import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useAppStore } from 'renderer/src/AppContext';
import styles from './TranscribedText.module.css';
import type { TranscriptView } from 'renderer/src/stores/transcriptFormat';

type WorkspaceView = TranscriptView | 'summary';

const transcriptViews = [
    { value: 'plain', label: 'Text' },
    { value: 'timecodes', label: 'Timecodes' },
    { value: 'speakers', label: 'Speakers' },
    { value: 'summary', label: 'Summary' },
] as const;

interface ViewSwitchProps {
    view: WorkspaceView;
    onViewChange: (view: WorkspaceView) => void;
    viewLockReasons: Partial<Record<WorkspaceView, string>>;
}

export const TranscriptViewSwitch: React.FC<ViewSwitchProps> = ({ view, onViewChange, viewLockReasons }) => {
    const reasons = Array.from(new Set(Object.values(viewLockReasons)));
    return (
        <Box className={styles.viewOptions}>
            <SegmentedControl
                aria-label="Transcript view"
                aria-describedby={reasons.length ? 'transcript-view-lock' : undefined}
                value={view}
                onChange={(value) => {
                    const next = transcriptViews.find((option) => option.value === value)?.value;
                    if (next && !viewLockReasons[next]) onViewChange(next);
                }}
                classNames={{ root: styles.viewToggle, label: styles.toggleLabel }}
                data={transcriptViews.map(({ value, label }) => ({
                    value, label: <span title={viewLockReasons[value]}>{label}</span>, disabled: Boolean(viewLockReasons[value]),
                }))}
            />
            {reasons.length ? <Text id="transcript-view-lock" size="xs" c="dimmed">{reasons.join(' ')}</Text> : null}
        </Box>
    );
};

interface Props extends ViewSwitchProps {
    currentTextValue: string;
    getClipboardHtml: () => string;
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
    viewLockReasons,
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
                <TranscriptViewSwitch view={view} onViewChange={onViewChange} viewLockReasons={viewLockReasons} />

                <Group gap={8} align="center" wrap="nowrap" className={view === 'summary' ? styles.summaryActions : styles.actionsGroup}>
                    {view !== 'summary' && (
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
                    )}
                    {(view !== 'summary' || currentTextValue) && <ActionIcon
                        variant="default"
                        disabled={currentTextValue.length === 0}
                        onClick={handleCopy}
                        aria-label={view === 'summary' ? 'Copy summary' : 'Copy transcript'}
                        title={view === 'summary' ? 'Copy summary' : 'Copy transcript'}
                        size={32}
                    >
                        <IconCopy size={16} />
                    </ActionIcon>}
                    <Button
                        size="sm"
                        variant="default"
                        disabled={currentTextValue.length === 0 || Boolean(store.exportBlockReason)}
                        title={store.exportBlockReason}
                        aria-description={store.exportBlockReason}
                        onClick={handleSave}
                        leftSection={<IconDownload size={16} />}
                        className={styles.exportButton}
                    >
                        {view === 'summary' ? 'Export summary' : 'Export'}
                    </Button>
                </Group>
            </div>
            {view !== 'summary' && store.transcription.duplicateFilterAvailable ? (
                <Switch
                    checked={store.transcription.duplicateFilterEnabled}
                    disabled={store.operations.isBusy}
                    title={store.operationBlockReason}
                    aria-description={store.operationBlockReason}
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
