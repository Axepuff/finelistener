import { ActionIcon, Box, Group, Loader, Menu, Progress, ScrollArea, Stack, Text, TextInput, Tooltip, UnstyledButton } from '@mantine/core';
import { IconDotsVertical, IconFolder, IconRefresh, IconSearch, IconTrash, IconX } from '@tabler/icons-react';
import { RecordingRecovery } from '@~/recorder';
import { observer } from 'mobx-react-lite';
import React, { useRef, useState } from 'react';
import { useAppStore } from 'renderer/src/AppContext';
import { formatSessionMeta, groupSessions } from '../../model/sessionList';
import './SessionsSidebar.css';

export const SessionsSidebar: React.FC = observer(() => {
    const store = useAppStore();
    const { sessions, workspace } = store;
    const [query, setQuery] = useState('');
    const [openedMenuSessionId, setOpenedMenuSessionId] = useState<string | null>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const groups = groupSessions(sessions.items, query);

    const handleOpenSession = async (sessionId: string) => {
        setOpenedMenuSessionId(null);
        const result = await store.openSession(sessionId);
        if (!result.ok) store.activityLog.appendEvent(result.message);
    };

    const handleRevealFolder = async (sessionId: string) => {
        setOpenedMenuSessionId(null);
        const result = await store.revealSessionFolder(sessionId);
        if (!result.ok) store.activityLog.appendEvent(result.message);
    };

    const handleDeleteSession = async (sessionId: string, title: string) => {
        setOpenedMenuSessionId(null);
        if (!window.confirm(`Delete session "${title}"?\n\nThis will remove its audio and transcript files.`)) return;
        const result = await store.deleteSession(sessionId);
        if (!result.ok) store.activityLog.appendEvent(result.message);
        else searchRef.current?.focus();
    };

    const runningStatus = store.operations.kind === 'transcribing' ? `Transcribing… ${Math.round(store.transcription.progress)}%` :
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
                onChange={(event) => setQuery(event.currentTarget.value)}
                leftSection={<IconSearch size={16} />}
                rightSection={query ? <ActionIcon size={20} variant="subtle" color="gray" aria-label="Clear session search" onClick={() => { setQuery(''); searchRef.current?.focus(); }}><IconX size={14} /></ActionIcon> : null}
            />
            <ScrollArea className="sessions-panel__list" type="auto" offsetScrollbars="present">
                <Stack gap={12}>
                    <RecordingRecovery />
                    {sessions.error ? <Text size="sm" c="red">{sessions.error}</Text> : null}
                    {sessions.isLoading && sessions.items.length === 0 ? (
                        <Group gap={8}><Loader size={14} /><Text size="sm" c="dimmed">{'Loading sessions…'}</Text></Group>
                    ) : null}
                    {!sessions.isLoading && !sessions.error && groups.length === 0 ? (
                        <Text size="sm" c="dimmed">{sessions.items.length ? 'No sessions match your search.' : 'No sessions yet. Record or import audio to get started.'}</Text>
                    ) : null}
                    {groups.map((group) => (
                        <Box component="section" key={group.label} aria-label={group.label}>
                            <Text className="sessions-panel__group-title" size="xs" fw={600} c="dimmed">{group.label}</Text>
                            {group.items.map((session) => {
                                const isActive = session.id === workspace.activeSessionId;
                                const isMenuOpen = openedMenuSessionId === session.id;
                                const status = isActive ? runningStatus : null;
                                const speakerCount = isActive ? store.transcription.savedTranscript?.speakers?.speakers.length ?? session.speakerCount : session.speakerCount;
                                return (
                                    <Box key={session.id} className="session-row" data-current={isActive || undefined} data-menu-open={isMenuOpen || undefined}
                                        onContextMenu={(event) => { event.preventDefault(); setOpenedMenuSessionId(session.id); }}>
                                        <UnstyledButton className="session-row__open" aria-label={session.title} aria-current={isActive ? 'true' : undefined}
                                            aria-describedby={`session-meta-${session.id}${status ? ` session-status-${session.id}` : ''}`}
                                            title={session.title} disabled={store.operations.isBusy} onClick={() => void handleOpenSession(session.id)}>
                                            <Text component="span" id={`session-title-${session.id}`} className="session-row__title" size="sm" fw={600}>{session.title}</Text>
                                            <Text component="span" id={`session-meta-${session.id}`} size="xs" c="dimmed">{formatSessionMeta({ ...session, speakerCount })}</Text>
                                            {status ? (
                                                <Stack gap={4} pt={2}>
                                                    <Group gap={6} wrap="nowrap"><Loader size={12} aria-hidden={true} /><Text component="span" id={`session-status-${session.id}`} size="xs">{status}</Text></Group>
                                                    {store.operations.kind === 'transcribing' ? <Progress value={store.transcription.progress} size={4} aria-label="Transcription progress" /> : null}
                                                </Stack>
                                            ) : null}
                                        </UnstyledButton>
                                        <Menu withinPortal={true} position="bottom-end" opened={isMenuOpen} onChange={(opened) => setOpenedMenuSessionId(opened ? session.id : null)}>
                                            <Menu.Target>
                                                <ActionIcon className="session-row__actions" size={24} variant="subtle" color="gray" aria-label="Session actions" aria-describedby={`session-title-${session.id}`}>
                                                    <IconDotsVertical size={16} />
                                                </ActionIcon>
                                            </Menu.Target>
                                            <Menu.Dropdown>
                                                <Menu.Item leftSection={<IconFolder size={16} />} onClick={() => void handleRevealFolder(session.id)}>{'Reveal session folder'}</Menu.Item>
                                                <Menu.Divider />
                                                <Menu.Item color="red" leftSection={<IconTrash size={16} />} disabled={store.operations.isBusy} onClick={() => void handleDeleteSession(session.id, session.title)}>{'Delete session'}</Menu.Item>
                                            </Menu.Dropdown>
                                        </Menu>
                                    </Box>
                                );
                            })}
                        </Box>
                    ))}
                </Stack>
            </ScrollArea>
        </Stack>
    );
});
