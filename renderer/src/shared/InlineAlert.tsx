import { Alert, Button, Group, Stack } from '@mantine/core';
import { IconAlertCircle, IconAlertTriangle } from '@tabler/icons-react';
import type React from 'react';
import { useAppStore } from '../AppContext';

export const ShowInLog: React.FC = () => {
    const { activityLog } = useAppStore();
    return <Button variant="subtle" size="compact-xs" onClick={() => activityLog.show()}>Show in log</Button>;
};

interface Props {
    title: string;
    severity?: 'error' | 'warning';
    children: React.ReactNode;
    actions?: React.ReactNode;
}

export const InlineAlert: React.FC<Props> = ({ title, severity = 'error', children, actions }) => (
    <Alert role="alert" title={title} color={severity === 'error' ? 'red' : 'yellow'}
        icon={severity === 'error' ? <IconAlertCircle size={16} aria-hidden="true" /> : <IconAlertTriangle size={16} aria-hidden="true" />}
        p={12} style={{ flexShrink: 0, overflowWrap: 'anywhere' }}
        styles={{ root: { border: `1px solid var(--brand-color-${severity}-border)`, background: `var(--brand-color-${severity}-bg)` },
            title: { color: 'var(--brand-color-text)', fontSize: 14 }, message: { color: 'var(--brand-color-text)', fontSize: 12 } }}>
        <Stack gap={8}>
            {children}
            <Group gap={8}>{actions}<ShowInLog /></Group>
        </Stack>
    </Alert>
);
