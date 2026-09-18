import { ActionIcon, Group, Loader, Menu, Paper, ScrollArea, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { IconDotsVertical, IconFolder, IconRefresh, IconTrash } from '@tabler/icons-react';
import { observer } from 'mobx-react-lite';
import React, { useCallback, useState } from 'react';
import { useAppStore } from 'renderer/src/AppContext';

export const SessionsSidebar: React.FC = observer(() => {
    const store = useAppStore();
    const { workspace } = store;
    const [openedMenuSessionId, setOpenedMenuSessionId] = useState<string | null>(null);

    const handleRevealRoot = useCallback(async () => {
        const result = await store.revealSessionsFolder();

        if (!result.ok) {
            store.activityLog.appendEvent(result.message);
        }
    }, [store]);

    const handleOpenSession = useCallback(async (sessionId: string) => {
        const result = await store.openSession(sessionId);

        if (!result.ok) {
            store.activityLog.appendEvent(result.message);
        }
    }, [store]);

    const handleDeleteSession = useCallback(async (sessionId: string, title: string) => {
        const confirmed = window.confirm(
            `Delete session "${title}"?\n\nThis will remove its audio and transcript files.`,
        );

        if (!confirmed) {
            return;
        }

        const result = await store.deleteSession(sessionId);

        if (!result.ok) {
            store.activityLog.appendEvent(result.message);
        }
    }, [store]);

    const emptyStateText = workspace.sessionsLoading
        ? 'Loading sessions...'
        : workspace.sessionsLoadError ?? 'No sessions yet.';

    return (
        <Paper bg="gray.0" h="100%" style={{ minHeight: 0, overflow: 'hidden' }}>
            <Stack gap={12} p={16} h="100%" style={{ minHeight: 0 }}>
                <Group justify="space-between" align="center" wrap="nowrap">
                    <Text size="xs" fw={700} c="dimmed" style={{ letterSpacing: '0.08em' }}>
                        {'SESSIONS'}
                    </Text>
                    <Tooltip label="Refresh sessions" withArrow={true}>
                        <ActionIcon
                            variant="subtle"
                            onClick={() => void store.refreshSessions()}
                            disabled={workspace.sessionsLoading}
                        >
                            <IconRefresh size={16} />
                        </ActionIcon>
                    </Tooltip>
                </Group>

                {workspace.sessionsLoading && workspace.sessions.length === 0 ? (
                    <Group gap={8} align="center">
                        <Loader size={14} />
                        <Text size="sm" c="dimmed">
                            {'Loading sessions...'}
                        </Text>
                    </Group>
                ) : null}

                {!workspace.sessionsLoading && workspace.sessions.length === 0 ? (
                    <Text size="sm" c="dimmed">
                        {emptyStateText}
                    </Text>
                ) : null}

                {workspace.sessions.length > 0 ? (
                    <ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto">
                        <Stack gap={8}>
                            {workspace.sessions.map((session) => {
                                const isActive = session.id === workspace.activeSessionId;
                                const isMenuOpen = openedMenuSessionId === session.id;
                                const createdLabel = new Date(session.createdAt).toLocaleString();

                                return (
                                    <UnstyledButton
                                        key={session.id}
                                        disabled={store.operations.isBusy}
                                        onClick={() => {
                                            setOpenedMenuSessionId(null);
                                            void handleOpenSession(session.id);
                                        }}
                                        onContextMenu={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            setOpenedMenuSessionId(session.id);
                                        }}
                                        style={{
                                            width: '100%',
                                            textAlign: 'left',
                                        }}
                                    >
                                        <Paper
                                            withBorder={isActive}
                                            p={10}
                                            bg={isActive ? 'white' : undefined}
                                            style={{
                                                borderColor: isActive ? 'var(--mantine-color-gray-5)' : undefined,
                                            }}
                                        >
                                            <Group justify="space-between" align="flex-start" wrap="nowrap" gap={8}>
                                                <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
                                                    <Group gap={6} align="center" wrap="nowrap">
                                                        <Text size="sm" fw={600} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                            {session.title}
                                                        </Text>
                                                    </Group>
                                                    <Text size="xs" c="dimmed">
                                                        {createdLabel}
                                                    </Text>
                                                </Stack>

                                                <Menu
                                                    withinPortal={true}
                                                    position="bottom-end"
                                                    opened={isMenuOpen}
                                                    onChange={(opened) => {
                                                        setOpenedMenuSessionId(opened ? session.id : null);
                                                    }}
                                                >
                                                    <Menu.Target>
                                                        <ActionIcon
                                                            variant="subtle"
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                            }}
                                                            aria-label="Session actions"
                                                        >
                                                            <IconDotsVertical size={16} />
                                                        </ActionIcon>
                                                    </Menu.Target>
                                                    <Menu.Dropdown>
                                                        <Menu.Item
                                                            leftSection={<IconFolder size={16} />}
                                                            onClick={() => {
                                                                setOpenedMenuSessionId(null);
                                                                void handleRevealRoot();
                                                            }}
                                                        >
                                                            {'Reveal sessions folder'}
                                                        </Menu.Item>
                                                        <Menu.Divider />
                                                        <Menu.Item
                                                            color="red"
                                                            leftSection={<IconTrash size={16} />}
                                                            disabled={store.operations.isBusy}
                                                            onClick={() => {
                                                                setOpenedMenuSessionId(null);
                                                                void handleDeleteSession(session.id, session.title);
                                                            }}
                                                        >
                                                            {'Delete session'}
                                                        </Menu.Item>
                                                    </Menu.Dropdown>
                                                </Menu>
                                            </Group>
                                        </Paper>
                                    </UnstyledButton>
                                );
                            })}
                        </Stack>
                    </ScrollArea>
                ) : null}

                {workspace.sessionsLoadError ? (
                    <Text size="sm" c="red">
                        {workspace.sessionsLoadError}
                    </Text>
                ) : null}
            </Stack>
        </Paper>
    );
});
