import { Box, Group, Text, UnstyledButton } from '@mantine/core';
import { IconLock, IconTerminal } from '@tabler/icons-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { useAppStore } from 'renderer/src/AppContext';
import { SHELL_SIZES } from '../model/shellSizes';

interface Props {
    isLogOpen: boolean;
    onToggleLog: () => void;
}

export const StatusBar: React.FC<Props> = observer(({ isLogOpen, onToggleLog }) => {
    const { transcriptionControl: control } = useAppStore();
    // The renderer does not know the compute device yet, so only the model is shown.
    const modelLabel = control.useCustomModelFile ?
        control.customModelFile?.fileName ?? 'Custom model' :
        control.model;

    return (
        <Group
            component="footer"
            gap={16}
            wrap="nowrap"
            h={SHELL_SIZES.statusBarHeight}
            px={16}
            style={{
                flex: `0 0 ${SHELL_SIZES.statusBarHeight}px`,
                background: 'var(--brand-color-bg-container)',
                borderTop: 'var(--brand-line-width) solid var(--brand-color-border)',
                color: 'var(--brand-color-text-secondary)',
            }}
        >
            <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                <IconLock size={14} aria-hidden={true} style={{ flexShrink: 0 }} />
                <Text size="xs" c="var(--brand-color-text-secondary)" truncate="end">
                    {'Runs offline. Audio never leaves this computer.'}
                </Text>
            </Group>
            <Box style={{ flex: 1 }} />
            <Text size="xs" c="var(--brand-color-text-secondary)" ff="var(--brand-font-family-code)" style={{ flexShrink: 0 }}>
                {modelLabel}
            </Text>
            <UnstyledButton
                onClick={onToggleLog}
                aria-pressed={isLogOpen}
                style={{
                    height: 20,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '0 6px',
                    borderRadius: 3,
                    flexShrink: 0,
                    fontSize: 12,
                    color: isLogOpen ? 'var(--brand-color-text)' : 'var(--brand-color-text-secondary)',
                    background: isLogOpen ? 'var(--brand-color-fill-secondary)' : 'transparent',
                }}
            >
                <IconTerminal size={14} aria-hidden={true} />
                {'Log'}
            </UnstyledButton>
        </Group>
    );
});
