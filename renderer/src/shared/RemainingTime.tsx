import { Text } from '@mantine/core';
import { observer } from 'mobx-react-lite';
import React, { useEffect, useState } from 'react';
import type { ProgressEstimate } from '../stores/progressEstimate';

interface Props {
    estimate: ProgressEstimate;
    showStart?: boolean;
}

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export const RemainingTime: React.FC<Props> = observer(({ estimate, showStart }) => {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1_000);
        return () => window.clearInterval(timer);
    }, []);
    const remaining = estimate.label(now);
    if (!showStart && !remaining) return null;
    return <Text size="xs" c="dimmed">
        {showStart && <>Started {clock.format(estimate.startedAt)}{remaining && ' · '}</>}
        {remaining}
    </Text>;
});
