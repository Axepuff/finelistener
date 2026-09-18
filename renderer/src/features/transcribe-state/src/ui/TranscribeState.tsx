import { Loader } from '@mantine/core';
import { observer } from 'mobx-react-lite';
import { FC } from 'react';
import { useAppStore } from 'renderer/src/AppContext';

export const TranscribeState: FC = observer(() => {
    const state = useAppStore().lifecycleState;

    if (state === 'transcribing') {
        return <Loader color="green" />;
    }

    return null;
});
