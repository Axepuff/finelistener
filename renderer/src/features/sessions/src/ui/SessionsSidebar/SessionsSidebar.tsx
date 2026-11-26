import { ActionIcon, Box, Group, Loader, Menu, ScrollArea, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import { IconDotsVertical, IconFolder, IconLock, IconRefresh, IconSearch, IconTrash, IconX } from '@tabler/icons-react';
import { formatRecordingClock, RecordingRecovery } from '@~/recorder';
import { observer } from 'mobx-react-lite';
import React, { useCallback, useId, useImperativeHandle, useRef, useState } from 'react';
import { useAppStore } from 'renderer/src/AppContext';
import { formatSessionMeta, groupSessions } from '../../model/sessionList';
import './SessionsSidebar.css';

interface SessionMenuTarget {
    sessionId: string;
    button: HTMLButtonElement;
}

// Give the shared floating menu the row's existing button so opening it preserves focus.
const MenuAnchor: React.FC<{ button: HTMLButtonElement; ref?: React.Ref<HTMLButtonElement> }> = ({ button, ref }) => {
    useImperativeHandle(ref, () => button, [button]);
    return null;
};

export const SessionsSidebar: React.FC = observer(() => {
    const store = useAppStore();
    const { sessions, workspace } = store;
    const [query, setQuery] = useState('');
    const [menuTarget, setMenuTarget] = useState<SessionMenuTarget | null>(null);
    const menuId = useId();
    const searchRef = useRef<HTMLInputElement>(null);
    const groups = groupSessions(sessions.items, query);
    const menuSession = menuTarget ? sessions.items.find((session) => session.id === menuTarget.sessionId) : undefined;
    const watchMenuButton = useCallback((button: HTMLButtonElement | null) => {
        if (!button) return;
        // A refresh can move the session to another date group and replace its button.
        return () => setMenuTarget((current) => current?.button === button ? null : current);
    }, []);
    const openMenu = (sessionId: string, button: HTMLButtonElement) => {
        button.focus({ preventScroll: true });
        setMenuTarget({ sessionId, button });
    };

    const handleOpenSession = async (sessionId: string) => {
        setMenuTarget(null);
        const result = await store.openSession(sessionId);
        if (!result.ok) store.activityLog.appendEvent(result.message);
    };

    const handleRevealFolder = async (sessionId: string) => {
        setMenuTarget(null);
        const result = await store.revealSessionFolder(sessionId);
        if (!result.ok) store.activityLog.appendEvent(result.message);
    };

    const handleDeleteSession = async (sessionId: string, title: string) => {
        setMenuTarget(null);
        if (store.operations.isBusy) return;
        if (!window.confirm(`Delete session "${title}"?\n\nThis will remove its audio and transcript files.`)) return;
        const result = await store.deleteSession(sessionId);
        if (!result.ok) store.activityLog.appendEvent(result.message);
        else searchRef.current?.focus();
    };

    const { recordingInProgress, operationBlockReason } = store;
    const sessionLockReason = store.operations.kind === 'recording' ? 'Other sessions open after you stop recording.' :
        store.operations.kind === 'transcribing' ? 'Other sessions open after transcription finishes, or when you stop it.' : operationBlockReason;
    const progress = store.transcription.reportedProgress;
    const runningStatus = store.operations.kind === 'transcribing' ? (store.transcription.recognitionStarted ?
        `Transcribing…${progress === null ? '' : ` ${Math.round(progress)}%`}` : 'Preparing audio…') :
        store.operations.kind === 'analyzing-speakers' ? 'Analyzing speakers…' :
            store.operations.kind === 'optimizing-audio' ? 'Optimizing audio…' :
                store.operations.kind === 'summarizing' ? 'Generating summary…' : null;

    return (
        <Stack className="sessions-panel" gap={12} p={16} h="100%">
            <Group justify="space-between" wrap="nowrap">
                <Text component="h2" m={0} size="lg" fw={600}>{'Sessions'}</Text>
                <Group gap={6} wrap="nowrap">
                    <Text size="xs" c="dimmed" aria-label={`${sessions.items.length} sessions`}>{sessions.items.length}</Text>
                    <Tooltip label="Refresh sessions">
                        <ActionIcon size={24} variant="subtle" color="gray" aria-label="Refresh sessions" onClick={() => void sessions.refresh()} disabled={sessions.isLoading}>
                            <IconRefresh size={14} />
                        </ActionIcon>
                    </Tooltip>
                </Group>
            </Group>
            <TextInput
                ref={searchRef}
                type="search"
                aria-label="Search sessions"
                placeholder="Search sessions"
                value={query}
                onChange={(event) => { setMenuTarget(null); setQuery(event.currentTarget.value); }}
                leftSection={<IconSearch size={16} />}
                rightSection={query ? <ActionIcon size={20} variant="subtle" color="gray" aria-label="Clear session search" onClick={() => { setQuery(''); searchRef.current?.focus(); }}><IconX size={14} /></ActionIcon> : null}
            />
            <ScrollArea className="sessions-panel__list" type="auto" offsetScrollbars="present">
                <Stack gap={12}>
                    {recordingInProgress ? (
                        <Box className="session-row session-row--recording" data-current={true} aria-current="true">
                            <Stack gap={2}>
                                <Group gap={8} wrap="nowrap"><span aria-hidden="true" className="session-row__recording-dot" />
                                    <Text size="sm" fw={600}>New recording</Text>
                                </Group>
                                <Text size="xs" c="dimmed">{[
                                    store.operations.kind === 'processing-recording' ? 'Saving recording…' : 'Recording',
                                    formatRecordingClock(store.recording.session.recordingDurationMs),
                                    store.recording.session.recordingSources.map((source) => source === 'system' ? 'System audio' : 'Microphone').join(' + '),
                                ].filter(Boolean).join(' · ')}</Text>
                            </Stack>
                        </Box>
                    ) : null}
                    {sessionLockReason ? (
                        <Group gap={8} align="flex-start" wrap="nowrap" className="sessions-panel__lock" role="note">
                            <IconLock size={14} aria-hidden="true" />
                            <Text id="sessions-lock-reason" size="xs">{sessionLockReason}</Text>
                        </Group>
                    ) : null}
                    <RecordingRecovery />
                    {sessions.error ? <Text size="sm" c="red">{sessions.error}</Text> : null}
                    {sessions.isLoading && sessions.items.length === 0 ? (
                        <Group gap={8}><Loader size={14} /><Text size="sm" c="dimmed">{'Loading sessions…'}</Text></Group>
                    ) : null}
                    {!sessions.isLoading && !sessions.error && groups.length === 0 && (!recordingInProgress || sessions.items.length > 0) ? (
                        <Text size="sm" c="dimmed">{sessions.items.length ? 'No sessions match your search.' : 'No sessions yet. Record or import audio to get started.'}</Text>
                    ) : null}
                    {groups.map((group) => (
                        <Box component="section" key={group.label} aria-label={group.label}>
                            <Text className="sessions-panel__group-title" size="xs" fw={600} c="dimmed">{group.label}</Text>
                            {group.items.map((session) => {
                                const isActive = !recordingInProgress && session.id === workspace.activeSessionId;
                                const isMenuOpen = menuSession?.id === session.id;
                                const status = isActive ? runningStatus : null;
                                const speakerCount = isActive ? store.transcription.savedTranscript?.speakers?.speakers.length ?? session.speakerCount : session.speakerCount;
                                return (
                                    <div key={session.id} className="session-row" data-current={isActive || undefined} data-menu-open={isMenuOpen || undefined}
                                        onContextMenu={(event) => {
                                            event.preventDefault();
                                            const button = event.currentTarget.querySelector<HTMLButtonElement>('.session-row__actions');
                                            if (button) openMenu(session.id, button);
                                        }}>
                                        <button type="button" className="session-row__open mantine-focus-auto" aria-label={session.title} aria-current={isActive ? 'true' : undefined}
                                            aria-describedby={`session-meta-${session.id}${status ? ` session-status-${session.id}` : ''}${sessionLockReason ? ' sessions-lock-reason' : ''}`}
                                            title={sessionLockReason ?? session.title} disabled={store.operations.isBusy} onClick={() => void handleOpenSession(session.id)}>
                                            <span id={`session-title-${session.id}`} className="session-row__title">{session.title}</span>
                                            <span id={`session-meta-${session.id}`} className="session-row__meta">{formatSessionMeta(session, speakerCount)}</span>
                                            {status ? (
                                                <Stack gap={4} pt={2}>
                                                    <Group gap={6} wrap="nowrap"><Loader size={12} aria-hidden={true} /><Text component="span" id={`session-status-${session.id}`} size="xs">{status}</Text></Group>

                                                </Stack>
                                            ) : null}
                                        </button>
                                        <button type="button" className="session-row__actions mantine-focus-auto" aria-label="Session actions"
                                            aria-describedby={`session-title-${session.id}`} aria-haspopup="menu" aria-expanded={isMenuOpen}
                                            ref={isMenuOpen ? watchMenuButton : undefined} id={isMenuOpen ? menuId + '-trigger' : undefined} aria-controls={isMenuOpen ? menuId : undefined}
                                            onClick={(event) => isMenuOpen ? setMenuTarget(null) : openMenu(session.id, event.currentTarget)}>
                                            <IconDotsVertical size={16} aria-hidden="true" />
                                        </button>
                                    </div>
                                );
                            })}
                        </Box>
                    ))}
                </Stack>
            </ScrollArea>
            <Menu withinPortal={true} position="bottom-end" opened={Boolean(menuSession)} onChange={(opened) => { if (!opened) setMenuTarget(null); }}>
                {menuTarget && <Menu.Target><MenuAnchor button={menuTarget.button} /></Menu.Target>}
                <Menu.Dropdown id={menuId} aria-labelledby={menuId + '-trigger'}>
                    {menuSession && <>
                        <Menu.Item leftSection={<IconFolder size={16} />} onClick={() => void handleRevealFolder(menuSession.id)}>{'Reveal session folder'}</Menu.Item>
                        <Menu.Divider />
                        <Menu.Item color="red" leftSection={<IconTrash size={16} />} disabled={store.operations.isBusy} title={operationBlockReason} aria-description={operationBlockReason}
                            onClick={() => void handleDeleteSession(menuSession.id, menuSession.title)}>{'Delete session'}</Menu.Item>
                    </>}
                </Menu.Dropdown>
            </Menu>
        </Stack>
    );
});
