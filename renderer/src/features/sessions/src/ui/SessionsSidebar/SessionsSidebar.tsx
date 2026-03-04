import { ActionIcon, Group, Loader, Menu, Paper, ScrollArea, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { IconDotsVertical, IconFolder, IconRefresh, IconTrash } from '@tabler/icons-react';
import type { SessionTranscriptV1 } from 'electron/src/types/sessions';
import { useAtomValue, useSetAtom } from 'jotai';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { atoms } from 'renderer/src/atoms';

const formatSecondsReadable = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '';

    const totalMs = Math.round(seconds * 1000);
    const hours = Math.floor(totalMs / 3_600_000);
    const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
    const secs = Math.floor((totalMs % 60_000) / 1000);

    const hh = String(hours).padStart(2, '0');
    const mm = String(minutes).padStart(2, '0');
    const ss = String(secs).padStart(2, '0');

    return `${hh}:${mm}:${ss}`;
};

const escapeHtml = (value: string) =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const buildTranscriptText = (transcript: SessionTranscriptV1): { plainText: string; renderedText: string } => {
    const lines: string[] = [];
    const htmlLines: string[] = [];

    for (const segment of transcript.segments) {
        const start = typeof segment.startSec === 'number' ? segment.startSec : 0;
        const end = typeof segment.endSec === 'number' ? segment.endSec : null;
        const startLabel = formatSecondsReadable(start);
        const endLabel = end !== null ? formatSecondsReadable(end) : '';
        const label = end !== null ? `[${startLabel} --> ${endLabel}]` : `[${startLabel}]`;
        const dataRegion = Number.isFinite(start) ? start.toFixed(3) : '0';
        const text = segment.text ?? '';

        lines.push(`${label} ${text}`.trimEnd());
        htmlLines.push(
            `<span data-regions="${escapeHtml(dataRegion)}">${escapeHtml(label)}</span>${text ? ` ${escapeHtml(text)}` : ''}`,
        );
    }

    return {
        plainText: lines.length > 0 ? `${lines.join('\n')}\n` : '',
        renderedText: htmlLines.length > 0 ? `${htmlLines.join('\n')}\n` : '',
    };
};

export const SessionsSidebar: React.FC = () => {
    const sessions = useAtomValue(atoms.sessions.items);
    const isLoading = useAtomValue(atoms.sessions.isLoading);
    const loadError = useAtomValue(atoms.sessions.loadError);
    const currentSessionId = useAtomValue(atoms.sessions.currentSessionId);
    const refreshSessions = useSetAtom(atoms.refreshSessions);
    const setCurrentSessionId = useSetAtom(atoms.sessions.currentSessionId);
    const setCurrentSessionDetails = useSetAtom(atoms.sessions.currentSessionDetails);
    const setAudioMode = useSetAtom(atoms.sessions.audioMode);
    const setAudioToTranscribe = useSetAtom(atoms.transcription.audioToTranscribe);
    const clearOutput = useSetAtom(atoms.clearTranscriptionOutput);
    const setPlainText = useSetAtom(atoms.transcription.plainText);
    const setRenderedText = useSetAtom(atoms.transcription.renderedText);
    const setUiState = useSetAtom(atoms.appState.uiState);
    const [openedMenuSessionId, setOpenedMenuSessionId] = useState<string | null>(null);

    useEffect(() => {
        void refreshSessions();
    }, [refreshSessions]);

    const handleRevealRoot = useCallback(async () => {
        try {
            await window.api?.sessions?.revealFolder?.();
        } catch (error) {
            console.error('Failed to reveal sessions folder', error);
        }
    }, []);

    const handleOpenSession = useCallback(async (sessionId: string) => {
        try {
            const api = window.api;

            if (!api?.sessions?.get) {
                return;
            }

            const details = await api.sessions.get(sessionId);

            clearOutput();
            setUiState('ready');
            setCurrentSessionId(details.id);
            setCurrentSessionDetails(details);
            setAudioMode('original');
            setAudioToTranscribe([details.audioWavPath]);

            if (details.transcript) {
                const { plainText, renderedText } = buildTranscriptText(details.transcript);

                setPlainText(plainText);
                setRenderedText(renderedText);
            }
        } catch (error) {
            console.error('Failed to open session', error);
        }
    }, [
        clearOutput,
        setAudioMode,
        setAudioToTranscribe,
        setCurrentSessionDetails,
        setCurrentSessionId,
        setPlainText,
        setRenderedText,
        setUiState,
    ]);

    const handleDeleteSession = useCallback(async (sessionId: string, title: string) => {
        const api = window.api;

        if (!api?.sessions?.delete) {
            return;
        }

        const confirmed = window.confirm(
            `Delete session "${title}"?\n\nThis will remove its audio and transcript files.`,
        );

        if (!confirmed) {
            return;
        }

        try {
            await api.sessions.delete(sessionId);

            if (currentSessionId === sessionId) {
                clearOutput();
                setUiState('initial');
                setCurrentSessionId(null);
                setAudioToTranscribe([]);
                setPlainText('');
                setRenderedText('');
            }

            void refreshSessions();
        } catch (error) {
            console.error('Failed to delete session', error);
        }
    }, [
        clearOutput,
        currentSessionId,
        refreshSessions,
        setAudioToTranscribe,
        setCurrentSessionId,
        setPlainText,
        setRenderedText,
        setUiState,
    ]);

    const emptyStateText = useMemo(() => {
        if (isLoading) return 'Loading sessions...';
        if (loadError) return 'Failed to load sessions.';

        return 'No sessions yet.';
    }, [isLoading, loadError]);

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
                            onClick={() => void refreshSessions()}
                            disabled={isLoading}
                        >
                            <IconRefresh size={16} />
                        </ActionIcon>
                    </Tooltip>
                </Group>

                {isLoading && sessions.length === 0 ? (
                    <Group gap={8} align="center">
                        <Loader size={14} />
                        <Text size="sm" c="dimmed">
                            {'Loading sessions...'}
                        </Text>
                    </Group>
                ) : null}

                {!isLoading && sessions.length === 0 ? (
                    <Text size="sm" c="dimmed">
                        {emptyStateText}
                    </Text>
                ) : null}

                {sessions.length > 0 ? (
                    <ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto">
                        <Stack gap={8}>
                            {sessions.map((session) => {
                                const isActive = session.id === currentSessionId;
                                const isMenuOpen = openedMenuSessionId === session.id;
                                const createdLabel = new Date(session.createdAt).toLocaleString();

                                return (
                                    <UnstyledButton
                                        key={session.id}
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

                {loadError ? (
                    <Text size="sm" c="red">
                        {loadError}
                    </Text>
                ) : null}
            </Stack>
        </Paper>
    );
};
